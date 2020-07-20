-- Create the tables.
create table
"User" (
  "userId"    serial primary key,  -- 64 bit on Postgres, adequate.
  "firstName" varchar(32), -- Arbitrary "long enough".
  "lastName"  varchar(32),
  email       varchar(32),
  password    char(64) -- Just the bcrypt result.
);

-- NOTE: 'Birdie Beahan' is not unique, two different user emails.
create index "User_firstName_lastName" on "User"("firstName", "lastName"); -- Initial load needs this.
create unique index "User_email" on "User"(email);  -- Auth needs this.

create table
"Merchant" (
  "merchantId" serial primary key,
  name         varchar(32), -- Arbitrary "long enough".
  latitude     real,  -- Enough precision for a guided missile.
  longitude    real,
  address      varchar(120) -- Could be TEXT.
);

-- create unique index "Merchant_pk" on "Merchant_pk"("merchantId");  -- SQLite does not do it.
create index "Merchant_name" on "Merchant"(name);  -- Needed for initial load.

create table
"Transaction" (
  -- NOTE: An artificial PK would be needed in reality.
  -- Otherwise accounting and audit turn into hell.
  "userId"         integer not null references "User"("userId"),
  "merchantId"     integer not null references "Merchant"("merchantId"),
  "amountInCents"  integer, -- Up to $42M, okay.
  "timestamp"      timestamp -- Nanoseconds are overrated.
);

-- NOTE: FK indexes should not enabled during the initial load.
-- For fast balance lookup:
create index "Transaction_User_Merchant" on "Transaction"("userId", "merchantId");

-- Extract the data fromt the transactions CSV joined dump.

create table
sample (
  firstName varchar(32),
  lastName varchar(32),
  email varchar(32),
  password varchar(64),
  walletId uuid,
  longitude real,
  latitude real,
  merchant varchar(32),
  amountInCents integer,
  createdAt bigint
);

copy sample from '/var/lib/postgresql/data/transactions.csv' delimiter ',' csv header;

insert into "User" ("firstName", "lastName", "email", "password")
select distinct firstName, lastName, email, password
from sample;

-- Merchant names repeat, e.g. 7-eleven at different locations.
insert into "Merchant" (name, latitude, longitude)
select distinct merchant, latitude, longitude
from sample;


insert into "Transaction" ("userId", "merchantId", "amountInCents", "timestamp")
select
  (select "userId" from "User" u
  where u.email = s.email) as "userId",
  (select "merchantId" from "Merchant" m
  where m.name = s.merchant and
        -- Comparing floats is hard. 1e-5 deg is about 1m.
        abs(m.longitude - s.longitude) < 1e-5 and
        abs(m.latitude - s.latitude) < 1e-5
  ) as "merchantId",
  s.amountInCents,
  timestamp 'epoch' + s.createdAt * interval '1 millisecond' as timestamp
from sample s;
