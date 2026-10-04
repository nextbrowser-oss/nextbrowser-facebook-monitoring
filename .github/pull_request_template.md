## Summary

<!-- What changed, why, and the impact on users of Nextbrowser or the CLI. -->

-

## Related issues

Closes #

## Change type

- [ ] Bug fix
- [ ] Change to what is read from facebook.com (page scripts)
- [ ] Change to keyword and mention matching or urgency triage
- [ ] Feature or enhancement
- [ ] Documentation or translation
- [ ] Maintenance or tooling

## Validation

- [ ] `npm run typecheck`
- [ ] `npm test`
- [ ] `npm run build`
- [ ] Checked live against facebook.com (describe the profile, the group and the result below)

```text
Commands and results:

```

## Page script changes

<!-- For changes to src/scripts.ts: the page, what Facebook drew and the date, and the trimmed fixture added. Write "Not applicable" otherwise. -->

## Checklist

- [ ] The engine stays read-only, clicks nothing, and keeps its pacing limits.
- [ ] No selector relies on Facebook's generated class names.
- [ ] Nothing outside `src/node/` imports Node.
- [ ] README translations are synchronized, if the README changed.
- [ ] No credentials, cookies, personal data, or generated `dist/` output are committed.
