# @phi/core

Shared TypeScript, browser-compatible. Used by `web`, `backend` and `verifier` so that hashing, normalisation and metadata checks are identical everywhere.

Not implemented yet.

## Responsibilities

- EIP-712 types and domains: `Post`, `PublishIntent` ("Phi Posts" domain, ADR-012) and `Receipt` / `Deadline` ("Phi Receipts" domain, ADR-015).
- `postHash` (EIP-712 `hashStruct(Post)`), `imageHash` (keccak256 of the final image bytes, or `0x0` without image).
- Leaf encoding and hashing: `keccak256(bytes.concat(keccak256(abi.encode(postHash, postArweaveId, sigCommit))))` (ADR-014).
- Merkle tree helpers on top of `@openzeppelin/merkle-tree` (sorted leaves, same double hashing as `PostAnchor.verifyPost`, ADR-005).
- Schemas and validators: post JSON (`phi.post/1`), manifest (`phi.manifest/1`), proof bundle (`phi.proof/1`), `config/trusted-keys.json`.
- Username and caption normalisation (NFC; username lowercase, charset `[a-z0-9_]`). The client applies it before signing; the server only checks it (ADR-012).
- WebP RIFF chunk parser: strips EXIF and XMP chunks in the client, detects them on the server so that both sides agree on what counts as metadata (ADR-003).
