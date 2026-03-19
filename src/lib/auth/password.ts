import bcrypt from "bcryptjs";

const BCRYPT_PASSWORD_BYTE_LIMIT = 72;

function isPasswordTooLong(password: string) {
  return Buffer.byteLength(password, "utf8") > BCRYPT_PASSWORD_BYTE_LIMIT;
}

export async function hashPassword(password: string) {
  if (isPasswordTooLong(password)) {
    throw new Error("Password must be 72 bytes or fewer");
  }

  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string) {
  if (isPasswordTooLong(password)) {
    return false;
  }

  return bcrypt.compare(password, hash);
}
