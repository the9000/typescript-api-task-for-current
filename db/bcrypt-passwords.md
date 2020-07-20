# Steps to change plaintext passwords to bcrypted versions

Assume the DB schema has beed processed as in `create-and-convert.sql`, and the DB is up using docker-compose.

Generate raw email + password pairs in `t-user.csv`.
```sh
psql -h localhost -U postgres <<EOF > T-user.csv
copy
(select email, password from "User")
to stdout delimiter ','
EOF
```

Convert the passwords using an ad-hoc python script, in a slow and naive way, because we only have 1k of them.

```py
import bcrypt
import csv
with open('t-user.csv') as f:
  reader = csv.reader(f)
  src_data = list(reader)

bcrypted_data = [(email, bcrypt.hashpw(password.encode('ascii'), bcrypt.gensalt())).decode('ascii')
  for (email, password) in src_data]

with open('bcrypted-user.csv', 'w') as f:
  writer = csv.writer(f)
  writer.writerows(bcrypted_data)
```

Import the table back into Postgres.

```sql
create table bcrypted (email varchar(32), password varchar(64));
```

```sh
(echo "copy bcrypted from stdin delimiter ',';"; cat bcrypted-user.csv) | psql -h localhost -U postgres
```

Run the actual update, then drop the temporary table.
```sh
psql -h localhost -U postgres <<EOF
update "User" u set password = (
  select password from bcrypted b
  where u.email = b.email
);
EOF
```
