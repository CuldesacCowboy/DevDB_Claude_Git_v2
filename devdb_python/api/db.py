# api/db.py
# Database utility helpers shared across routers.

import psycopg2.extras


def dict_cursor(conn):
    """Return a RealDictCursor for the given connection.

    Replaces the repeated boilerplate:
        conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    The caller is still responsible for closing the cursor (try/finally).
    """
    return conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
