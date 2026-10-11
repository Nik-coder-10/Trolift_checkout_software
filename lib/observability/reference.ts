const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

export function generateReferenceId(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  let result = "";
  for (let i = 0; i < 6; i++) {
    const byte = bytes[i] ?? 0;
    result += ALPHABET[byte % ALPHABET.length];
  }
  return `ERR-${result}`;
}
