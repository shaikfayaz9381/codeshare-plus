/**
 * Environment for unit tests.
 *
 * Unit tests never touch PostgreSQL or network services, but they do import
 * server modules that read configuration. Values here keep those modules
 * deterministic and fast (a low bcrypt cost in particular).
 */
const env = process.env as Record<string, string | undefined>;
env.NODE_ENV = env.NODE_ENV ?? "test";
env.HASH_SALT = "unit-test-hash-salt";
env.BCRYPT_COST = "10";
env.STORAGE_DRIVER = env.STORAGE_DRIVER ?? "local";
env.LOCAL_STORAGE_DIR = env.LOCAL_STORAGE_DIR ?? ".data/test/storage";
env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
