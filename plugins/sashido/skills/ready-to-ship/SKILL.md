---
name: ready-to-ship
description: Check a SashiDo app before it goes live or before a deploy, and say what must be fixed first. Use when the person asks "is this safe to launch?", "is it ready?", "check it before I ship", "review the security", and always before you deploy or push server code for them ("deploy it", "ship it", "push it live"). Checks who can read and write the data, sign-in settings, server code that won't run on the app's version, recent errors, how it runs, and secrets that would ship to users.
---

# Ready to ship

Answer one question: can this go live, and if not, what first. Follow the rules in the `backend` skill.

This works with a read-only token. Fixing needs a token that may change the app.

## 1. Look

Run these; none of them changes anything.

1. `get_app_advice`: who may read and write the data, sign-in and session settings, server code that stopped working on this version, health, errors in the last day, failed jobs.
2. `get_error_logs`, if the advice reported errors: what they are and how often. If an error came from your own work in this session (a call of yours that failed), say that, not "someone".
3. `get_process_metrics`: whether the app is close to its memory or CPU limit, or keeps restarting. A short CPU peak right at a deployment is the app starting up: not a finding.
4. In the project, look for secrets that would ship to users: a master key, a private key of another service, a database address, in the client code or in files that are bundled or committed. The app ID, the client key and the API URL are fine in a client. The master key never is.
5. If you are about to push server code: read what changed since the last deployment and check it against the version the app runs (`get_app_infrastructure`).

If a check could not run (the token lacks the permission, a tool failed), keep it in the answer as "not checked", with the reason.

## 2. Sort

**Must fix first.** The harm is real and comes right after launch:
- anyone, without signing in, can change or delete data, or create new kinds of data;
- a master key or another real secret in what ships to users;
- server code that will crash or silently not run on this version;
- the app does not answer its health check.

**Should fix.** Worth doing, may be on purpose:
- data anyone can read without signing in (fine for a public catalog, not for people's notes: ask if unsure);
- email verification off, weak password rules;
- errors in the last day; failed jobs;
- memory or CPU near the limit; an older Parse Server version.

**Fine.** Don't list what passed one by one. One line: what was checked and found in order.

## 3. Answer

Lead with the verdict. Say each finding by what it means for the app, not by its setting:

> **Not yet: 1 thing to fix first.**
> Anyone, without signing in, can add entries to "shares". I can close that; your app keeps working because it always signs in first.
> Should fix: 3 errors yesterday when a note had no title.
> Fine: sign-in, the other data, how it runs.
> Not checked: nothing.

## 4. Fix, if asked

Offer to fix the "must fix" items, one at a time. For each, say what the change does to the app before making it.

- Closing access with `update_class_permissions`: first `get_class_permissions`, and look at how the client uses that data. If the app has users and the client reads or writes it without signing in, the change breaks the app for them: say so and let the person choose.
- A secret in the client: remove it from the code, and tell the person it must also be replaced where it was issued, because it was already exposed. You can't do that part.
- Server code: fix it in the repository; it goes live with a push.

After fixing, run step 1 again and report the new state.

## When this runs before a deploy

If the person asked you to deploy and nothing is in "must fix", go on and deploy without an extra question; mention the "should fix" items in one line at the end.

If something is in "must fix", stop and say it. Deploy only after the person fixes it or tells you to deploy anyway.

`deploy_app` and `trigger_build` make the first of these checks themselves: when a class is open for everyone to write and delete, they start nothing and say so. Pass `deployAnyway: true` only after the person, having heard what it means for their app, said to go on. After a deploy, `wait_for_deployment`, then `check_app_health`.
