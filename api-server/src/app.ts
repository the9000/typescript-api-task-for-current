// The API server for Current's exercise.
import express from 'express';
import bodyParser from 'body-parser';
import morgan from 'morgan';

// Node does have Buffer.from, but it's not exposed in @types/node :(
import base64js from 'base64-js';

import Knex from 'knex';
import * as bcrypt from 'bcrypt';

const app = express();
app.use(morgan('dev')); // Log requests.
app.use(bodyParser());

// Quick and dirty; a real thing would read from secret storage.
const dbConfig = {
    client: 'pg',
    connection: {
        host: process.env.DB_HOST ?? 'db',
        user: process.env.DB_USER ?? 'postgres',
        password: process.env.POSTGRES_PASSWORD,
    }
}

const BCRYPT_ROUNDS = 12; // Fine for 2020.

const knex = Knex(dbConfig);

// I could use @awaitjs/express to make writing async handlers easier,
// and reporting the errors in a nicer way.
// But I'll be explicit here. rh = request handler.
class QuitWithHttpResponse extends Error {
    code: number;
    constructor (code: number, message: string) {
        super(message);
        this.code = code;
    }
}

function rh(callback: express.RequestHandler): express.RequestHandler {
    return function asyncHandler(req, res, next) {
        callback(req, res, next).catch((error: Error) => {
            if (error instanceof QuitWithHttpResponse) {
                res.status(error.code).json({ error: error.message });
                return;
            }
            else next(error);
        });
    }
}

// Normally we would have an auth layer which would issue session tokens,
// check for expiratin, etc.
// For demo purposes we'll just use a hard-coded admin access token.
const ADMIN_AUTH_HEADER = 'Bearer has-the-privilege';

function ensureAdminSession(
    req: express.Request, res: express.Response, next: express.NextFunction
): void {
    const authHeader = req.get('Authorization');
    if (authHeader === ADMIN_AUTH_HEADER) next();
    else res.status(401).json({error: 'You are not authorized for this action.'});
}
// Handlers.

app.get('/', (req, res) => {
  res.send('See https://gist.github.com/finco-trevor/d67f07c7b190d65e6b30e250fcb4de3f');
});

app.get('/test', rh(async (req, res) => {
    const users = await knex.select('*').from('User').where('userId', 1001);
    if (users.length != 1) res.status(500).json({error: `Got ${users.length} users.`});
    else res.json({user: users[0]});
}));

// We need to look things up somehow.
app.get('/users/:id', rh(async (req, res) => {
    const users = await knex.select('*').from('User').where('userId', req.params.id);
    if (users.length === 0) res.status(404).json({error: 'User ID not found'});
    else {
        const user = users[0];
        user.password = '<redacted>';
        res.json(user)
    };
}));



// TODO: move to a proper place!

/** Every JSON object is keyed by string unless it's an array. */
interface KeyedByString<T=any> {
    [key: string]: T;
}

interface SplitByFields {
    matched: KeyedByString;
    extra: string[];
    missing: string[];
}

function splitByFields(input: any, target: readonly string[]): SplitByFields {
    const keys: string[] = Object.keys(input);
    const required: string[] = target.map(k => k.toString());
    const extra = keys.filter(k => required.indexOf(k) < 0);
    const missing = required.filter(k => keys.indexOf(k) < 0);
    const matched: KeyedByString = {}
    for (const k of keys) matched[k] = input[k];
    return { matched, extra, missing };
}

const USER_RECORD_KEYS = ['firstName', 'lastName', 'email', 'password'] as const;
type UserRecordKeys = typeof USER_RECORD_KEYS[number]; // A union of string constants.

/** Members represent the DB fields. */
type UserRecord = {
    [key in UserRecordKeys]: string;
}

type UserUpdateRecord = Partial<UserRecord>;


interface ResultErrors<E> { errors: E[] };
interface ResultOk<R> { ok: R };
type Result<Success, Error>  =  ResultOk<Success> | ResultErrors<Error>;

interface FieldError {
    message: string,
    names: string[],  // Not <keyof T> because we want to report unexpected fields.
}

type ParseDataResult<T> = Result<T, FieldError>;

function trimmedValues(source: KeyedByString): KeyedByString<string> {
    const result: KeyedByString<string> = {};
    for (const f of Object.keys(source)) {
        if (typeof source[f] === 'string') result[f] = source[f].trim();
    }
    return result;
}

function blankKeys(data: KeyedByString): string[] {
    return Object.keys(data).filter(k => !data[k]); // nulls, empty strings, also zeros.
}

function addErrorsTo(target: FieldError[], names: string[], message: string) {
    if (names.length > 0) target.push({names, message});
}

// TODO: make generic over the type validated, if we ever have to validate more.
function parseUserData(data: any): ParseDataResult<UserRecord> {
    const { extra, missing, matched } = splitByFields(data, USER_RECORD_KEYS);
    const userData = trimmedValues(matched); // Fringe whitespace not needed.
    const blank = blankKeys(userData);
    // Could add more validations here, e.g. for email format or password strength.

    const errors: FieldError[] = [];
    addErrorsTo(errors, extra, 'Unexpected field');
    addErrorsTo(errors, missing, 'Field required but missing');
    addErrorsTo(errors, blank, 'Value required for field');
    if (errors.length > 0) return { errors } as ResultErrors<FieldError>;
    // Here we are certain that all fields are present and valid.
    return { ok: userData } as ResultOk<UserRecord>;
}

function parseUserUpdateData(data: any): ParseDataResult<UserUpdateRecord> {
    const { extra, matched } = splitByFields(data, USER_RECORD_KEYS);
    const userData = trimmedValues(matched); // Fringe whitespace not needed.
    const blank = blankKeys(userData);
    const allMissing = Object.keys(matched).length === 0 ? ['Want an element'] : [];
    // Could add more validations here, e.g. for email format or password strength.

    const errors: FieldError[] = [];
    addErrorsTo(errors, extra, 'Unexpected field');
    addErrorsTo(errors, blank, 'Value required for field');
    addErrorsTo(errors, allMissing, 'Nothing to update');
    if (errors.length > 0) return { errors } as ResultErrors<FieldError>;
    // Here we are certain that all fields are present and valid.
    return { ok: userData } as ResultOk<UserRecord>;
}

// Create new user.
app.post('/users', ensureAdminSession, rh(async (req, res) => {
    const parsed = parseUserData(req.body);
    if ('errors' in parsed) {
        res.status(400).json(parsed);
        return;
    }
    if ("ok" in parsed) {
        const userData: UserRecord = parsed.ok;
        userData.email = userData.email.toLowerCase();  // Canonicalize.
        // Turn the password into a hash.
        const hash = await bcrypt.hash(userData.password, BCRYPT_ROUNDS);
        userData.password = hash;  // Forget the plain text.
        // Check for duplicates.
        const doppelgangers = await knex.select('userId').from('User')
            .where('email', userData.email)
        if (doppelgangers.length > 0) {
            res.status(400).json({ error: 'Email already registered',
                                   email: userData.email });
            return;
        }
        // Store.
        const inserted = await knex.transaction(async trx => {
            return await trx('User').insert(userData).returning('userId');
        });
        res.status(201).json({ userId: inserted[0] });
        return;
    }
    throw new Error(`Non-exhaustive match: ${parsed}`);
}));

interface AuthData {
    username: string;
    password: string;
}

interface HttpError {
    code: number;
    message: string;
}

function getBasicAuth(authHeader: string): Result<AuthData, HttpError> {
    if (! authHeader.startsWith('Basic ')) {
        return {errors: [{ code: 400, message: 'Basic authorization required' }]};
    }
    const base64blob = authHeader.split('Basic ')[1];
    try {
        const decoded = new TextDecoder().decode(base64js.toByteArray(base64blob));
        const [username, password] = decoded.split(':');
        return {ok: { username, password }};
    } catch (error) {
        return {errors: [
            { code: 400,
              message: `Invalid authorization header format: ${authHeader}` }]};
    }
}

// Update a user.
app.patch('/users/:id', rh(async (req, res) => {
    // Basic auth should contain the current email and plaintext password.
    // Using basic auth via https is not insane, unlike via http.
    const authData = getBasicAuth(req.get('Authorization') || '');
    if ('errors' in authData) {
        const [error] = authData.errors;
        res.status(error.code).json({ error: error.message });
        return;
    }
    if ('ok' in authData) {
        const { username, password } = authData.ok;
        const foundUsers = await knex.select('*').from('User')
            .where({'email': username.toLowerCase(),
                    'userId': req.params.id});
        if (foundUsers.length !== 1) {
            throw new QuitWithHttpResponse(401, 'Invalid credentials');
            // res.status(401).json({error: 'Invalid credentials'});
            // return;
        }
        const targetUser = foundUsers[0];
        const passwordMatch = await bcrypt.compare(password, targetUser.password);
        if (! passwordMatch) {
            res.status(401).json({error: 'Invalid credentials'});
            return;  // Strictly the same answer each time.
        }
        // We can operate.
        const parsed = parseUserUpdateData(req.body);
        if ('errors' in parsed) {
            res.status(400).json(parsed);
            return;
        }
        if ('ok' in parsed) {
            const userData: UserUpdateRecord = parsed.ok;
            if ('password' in userData) {
                const hash = await bcrypt.hash(userData.password, BCRYPT_ROUNDS);
                userData.password = hash;  // Forget the plain text.
            }
            // NOTE: can't select for update while checking password,
            // because the DB can't select just the record we need,
            // it can't match the password.
            const updated = await knex.transaction(async trx => {
                return await trx('User').update(userData)
                    .where('userId', req.params.id);
            });
            res.status(200).json({ updated });
            return;
        }
        throw new Error(`Non-exhaustive match: ${parsed}`);
    }
    throw new Error(`Non-exhaustive match: ${authData}`);
}));

// User balance.
app.get('/users/:id/balance', rh(async (req, res) => {
    const foundRecords = await knex.sum('amountInCents').from('Transaction')
        .where('userId', req.params.id);
    if (foundRecords.length !== 1) {
        // Could also return 200 and {balance: 0}.
        res.status(404).json({error: 'No balance known'});
        return;
    }
    const target = foundRecords[0];
    // NOTE: The sum may be very large, and is represented
    // by a string. We do not return it as a number to avoid precision loss.
    // JSON can't handle BigInt :(
    res.status(200).json({ balance: target.sum });
}));

// Approve a transaction. Query parameter "amount": amount of transaction
app.get('/users/:id/approve', rh(async (req, res) => {
    if (isNaN(Number(req.query?.amount))) {
        res.status(400).json({error: 'Invalid amount'});
        return;
    }
    const amount = BigInt(req.query.amount);  // We want precision.
    let balance: BigInt;  // Balances are quite large, don't fit into an integer.
    const foundRecords = await knex.sum('amountInCents').from('Transaction')
        .where('userId', req.params.id);
    if (foundRecords.length !== 1) balance = BigInt(0);
    else balance = BigInt(foundRecords[0].sum);
    res.status(200).json({ approved: (balance >= amount) });
}));


function parseMaybeNumber(input: any, name: string): number | null {
    if ((input === undefined) && (input !== null)) return null;
    const inputStr = input.toString();
    const value = Number(inputStr);
    if (isNaN(value)) throw new QuitWithHttpResponse(400, `Invalid ${name}: "${inputStr}"`);
    return value;
}

function parseMaybeDate(input: any, name: string): Date | null {
    if ((input === undefined) && (input !== null)) return null;
    const inputStr = input.toString();
    try {
        return new Date(inputStr);
    } catch (error) {
        throw new QuitWithHttpResponse(400, `Invalid ${name}: "${inputStr}". ${error}`);
    }
}


interface TransactionRecord {
    userId: number;
    merchantId: number;
    amountInCents: string;  // Bigger that JS's integer.
    timestamp: number;
}

// Bonus: transaction lookup.
/* Query parameters:
merchant: number.
before: timestampin ISO format.
after: timestampin ISO format.
limit: number, number of records for pagination.
*/
app.get('/transactions/by-user/:id/', rh(async (req, res) => {
    const userId = parseMaybeNumber(req.params.id, 'user ID');
    const merchantId = parseMaybeNumber(req.query?.merchant, 'merchant ID');
    const timeBefore = parseMaybeDate(req.query?.before, 'time before');
    const timeAfter = parseMaybeDate(req.query?.after, 'time after');
    const limit = parseMaybeNumber(req.query?.limit, 'limit per page');
    let query = knex.select('*').from('Transaction').where('userId', userId);
    if (merchantId) query = query.where('merchantId', merchantId);
    if (timeBefore) query = query.where('timestamp', '<', timeBefore);
    if (timeAfter) query = query.where('timestamp', '>=', timeAfter);
    if (limit) query = query.limit(limit + 1);  // To know if there's next.
    const records = await query;
    const response: {transactions: TransactionRecord[], hasMore?: Boolean} = {transactions: []};
    if (limit && (records.length > limit)) {
        response.transactions = records.slice(0, limit);
        response.hasMore = true;
    } else response.transactions = records;
    res.status(200).json(response);
}));


// Bonus: summary of balances by merchant.
app.get('/users/:id/balances-by-merchant', rh(async (req, res) => {
    const foundRecords = await knex.select('merchantId').sum('amountInCents', {as: 'balance'})
        .from('Transaction')
        .where('userId', req.params.id)
        .groupBy('merchantId')
        .orderBy('merchantId');
    // NOTE: The sum may be very large, and is represented
    // by a string. We do not return it as a number to avoid precision loss.
    // JSON can't handle BigInt :(
    res.status(200).json(foundRecords);
}));



// Startup.
const port = process.env.API_PORT ?? 3000;

app.listen(port, (...args: Array<any>) => {
    if (args[0]) {
    return console.error(args[0]);
  }
  return console.log(`server is listening on ${port}`);
});
