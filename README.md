# This is a test, move along.

This is an interview take-home task.

## Demo

You can access the running API right at `demo.cheryasov.info` (while supplies last).
For instance, try [`http://demo.cheryasov.info/users/2124`](http://demo.cheryasov.info/users/2124).
If you sent me the original data, you know the passwords to all  users, too.

## The API

`GET /users/<id>` returns data about the user by ID.
The password is redacted.
No authorization required.

`POST /users` creates a new user.
Required fields: `firstName`, `lastName`, `email`, `password`.
The password is plaintext here.
The email has to be unique, everything else can repeat.
The return value is the ID of the created user.

This requires authorization, hard-coded as
`Authorization: Bearer has-the-privilege`
because implementing a proper session management flow is out of scope.

`PATCH /users/<id>` updates information about the user.
Allowed fields is any non-empty subset of `firstName`, `lastName`, `email`, `password`.
The password is plaintext here.
There is no return value, except when an error happens.

Authorization is basic, using the existing email and password for the user.

`GET /users/<id>/balance` shows the summary balance of all user's transactions.
No authorization required.

`GET /users/<id>/approve?amount=<number>` checks if the given amount does not exceed the balance.
No authorization required.
The return value is `{"approved": <true | false>}`.

`GET /users/<id>/balances-by-merchant` shows user's balances grouped by merchant.
No authorization required.

`GET /transactions/by-user/<id>` lists transactions in chronological order.
This endpoint makes most sense with a query string. The parameters are:
* `merchant`: number, merchant ID.
* `before`: timestampin ISO format, the upper exclusive bound of transaction timestamps.
* `after`: timestampin ISO format, the lower inclusive bound of transaction timestamps.
* `limit`:  number of records to show in output, together with `before` and `after` can be used for pagination.
No authorization required.
The return value is `{"transactions": [list of transactions], "hasMore": true}`;
the `hasMore` member is only present when `limit` is given, and the number of transactions to show is above the limit.


## The data

The data have been extracted from the transaction log presented, and stored according to the schema requested.

Users' passwords are stored as bcrypt hashes, converted once via a temporary table.

See [`db/create-and-convert.sql`](db/create-and-convert.sql) for the script.

## Running the whole thing

Just `make up` should set the server up and running for you.
See the [`docker-compose.yml`](docker-compose.yml) file for detals.

Currently there's no automatic data seeding make target, connect to the DB and paste stuff manually:
```
psql psql -h ::1 -U postgres
```

Various settings, including the DB password, are in the <config/> directiry.


## Tests

Tests are incomplete. They express the general idea though.

Tests get set up automatically. Just run `make test`.

Note: tests require Python.
