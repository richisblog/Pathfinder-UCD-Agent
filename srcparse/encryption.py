def encrypt(data: str, key: str) -> str:
    """Encrypt the data using a simple XOR with the repeating key."""
    if not data:
        return ''
    key_bytes = key.encode('utf-8')
    data_bytes = data.encode('utf-8')
    encrypted = bytearray()
    key_len = len(key_bytes)
    for i, byte in enumerate(data_bytes):
        encrypted.append(byte ^ key_bytes[i % key_len])
    return encrypted.hex()

def decrypt(encrypted_hex: str, key: str) -> str:
    """Decrypt the hex-encoded encrypted data using the same XOR with the key."""
    if not encrypted_hex:
        return ''
    key_bytes = key.encode('utf-8')
    encrypted_bytes = bytearray.fromhex(encrypted_hex)
    decrypted = bytearray()
    key_len = len(key_bytes)
    for i, byte in enumerate(encrypted_bytes):
        decrypted.append(byte ^ key_bytes[i % key_len])
    return decrypted.decode('utf-8')

if __name__ == "__main__":
    key = "Goodluck"
    test_data = "151a061e041c43212e0156565f465a5e7e5e5a220d190f4b755a"
    encrypted = encrypt(test_data, key)
    print(f"Encrypted: {encrypted}")
    decrypted = decrypt(test_data, key)
    print(f"Decrypted: {decrypted}") 