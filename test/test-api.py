# For a change, let's write the test suite in a different language.

import os
import pytest
from random import randint
import requests
from requests.auth import HTTPBasicAuth

# NOTE: User IDs are linked to the user IDs in the DB,
# which are a result of a particular import. Adjust accordingly when needed.
# Ideally the whole DB would be re-imported for tests, but it's a bit impractical now
# given the time constraints.

# We are using the "production" DB for testing because it's essentially a test DB.
# In real work, that would be a new, purpose-created DB for reach run.

NON_EXISTING_USER_ID_1 = 935098

API_HOST = 'http://localhost:80'

UNAUTH_HEADERS = {"Content-Type": "application/json"}
ADMIN_AUTH_HEADERS = {
    "Authorization": "Bearer has-the-privilege",
    "Content-Type": "application/json",
}

@pytest.fixture(scope = 'module')
def existing_user():
    return {
        "userId": 2102,
        "firstName": "Armani",
        "lastName": "Hickle",
        "email": "faker-1590686333666@email.com",
        "password" : "_0vOdDiNSkENHHy",
    }

@pytest.fixture(scope = 'function')  # A new random one every call.
def new_user():
    return {
        "firstName": "New %x" % randint(1000, 984509),
        "lastName": "User %x" % randint(1000, 984509),
        "email": "new-%x@email.com" % randint(1000, 3049540),
        "password" : "pass-%x"  % randint(753894, 3049540),
    }

@pytest.fixture(scope = 'function')
def random_name():
    return { "firstName": "First_%x" % randint(1000, 984509), }

@pytest.fixture(scope = 'function')
def random_email():
    return { "email": "foo_%x@bar.baz" % randint(1000, 984509), }


def url(the_path):
    return os.path.join(API_HOST, the_path);

def overlay(source: dict, replacements: dict) -> dict:
    all_keys = set(source).union(replacements)
    return {k: replacements.get(k, source.get(k)) for k in all_keys}

def test_look_up_existing_user(existing_user):
    res = requests.get(url('users/%d' % existing_user["userId"]), headers=UNAUTH_HEADERS)
    assert res.status_code == 200
    assert res.json() == overlay(existing_user, {"password": "<redacted>"})

def test_look_up_non_existing_user():
    res = requests.get(url('users/%d' % NON_EXISTING_USER_ID_1), headers=UNAUTH_HEADERS)
    assert res.status_code == 404
    assert res.json() == {"error": "User ID not found"}

def test_create_new_user(new_user):
    res_create = requests.post(url('users'), headers=ADMIN_AUTH_HEADERS, json=new_user)
    assert (res_create.status_code, res_create.json().get('error')) == (201, None)
    new_user_id = res_create.json()["userId"]
    assert isinstance(new_user_id, int)
    # Can we read it back?
    res_fetch = requests.get(url('users/%d' % new_user_id), headers=UNAUTH_HEADERS)
    assert (res_fetch.status_code, res_fetch.json().get('error')) == (200, None)
    assert res_fetch.json() == overlay(new_user, {"userId": new_user_id, "password": "<redacted>"})

def test_cannot_create_duplicate_user(existing_user, random_name):
    would_be_user = overlay(existing_user, random_name)
    del would_be_user['userId']
    res_create = requests.post(url('users'), headers=ADMIN_AUTH_HEADERS, json=would_be_user)
    assert ((res_create.status_code, res_create.json()) ==
            (400, {'error': 'Email already registered', 'email': would_be_user['email']}))

def test_update_user_info(new_user, random_name, random_email):
    res_create = requests.post(url('users'), headers=ADMIN_AUTH_HEADERS, json=new_user)
    assert (res_create.status_code, res_create.json().get('error')) == (201, None)
    new_user_id = res_create.json()["userId"]

    user_update = overlay(random_name, random_email)
    res_update = requests.patch(url('users/%d' % new_user_id),
                                auth=HTTPBasicAuth(new_user['email'], new_user['password']),
                                headers=UNAUTH_HEADERS, json=user_update)
    assert ((res_update.status_code, res_update.json()) == (200, {'updated': 1}))

    res_fetch = requests.get(url('users/%d' % new_user_id), headers=UNAUTH_HEADERS)
    assert (res_fetch.status_code, res_fetch.json().get('error')) == (200, None)
    assert res_fetch.json() == overlay(new_user, {
        "userId": new_user_id,
        'email': random_email['email'],
        'firstName': random_name['firstName'],
        'password': '<redacted>',
    })

# TODO: testing balances and transactions would take a proper test database, with a few controlled records,
# preferably inserted at the test setup time.
