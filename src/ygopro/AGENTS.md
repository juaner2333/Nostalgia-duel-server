# YGOPro Module Guidelines

## Fixed nostalgia boundary

- The only public room identifiers are `1103#<decimalRoomId>` and
  `1109#<decimalRoomId>`.
- Both formats use OCG rule `0`, Master Rule 2, MATCH mode, 8000 LP and
  best-of-3. Their names, pool, LFList hash and script path are immutable after
  room creation.
- Resource loading is fixed to one base CDB/script tree plus
  `formats/1103` and `formats/1109`. Each duel searches only its format script
  directory, then `base/script`.
- Do not introduce dynamic format commands, secondary card pools, external
  script paths or network resource refreshes.

## Module rules

- Keep room business rules in `room/domain`; resource access goes through a
  port supplied by infrastructure.
- Use `ygopro-msg-encode` for protocol framing and preserve existing room-state
  admission, reconnect and spectator behavior.
- Validate all client input. Invalid fixed-format identifiers must be rejected
  rather than falling back to legacy room-name or password semantics.
- Tests are co-located and must cover both formats whenever behavior depends on
  cards, scripts, ban lists or room identity.
