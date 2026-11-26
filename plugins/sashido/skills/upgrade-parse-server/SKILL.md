---
name: upgrade-parse-server
description: Move an app on SashiDo to a newer Parse Server version without breaking it. Use when the person says "upgrade Parse Server", "move me to the newest version", "is my server out of date?", "what breaks if I upgrade?", or when a check reports an older major version. Plans from the app's real server code by file and line, fixes the code first, switches the version after a preview, verifies, and keeps a way back.
---

# Upgrade Parse Server

The person has a Parse app and knows Parse, so its terms are fine here. Follow the other rules in the `backend` skill: one plan and one "yes", secrets stay with the person, an honest summary.

The order matters: **code first, version second.** The code is changed so that it works on both the old and the new version, deployed and verified on the old one, and only then is the version switched. That is what makes the way back a single step.

## 1. See where it stands

1. `get_app_infrastructure`: the version the app runs, and whether a deployment is rolling out. Don't start during a rollout.
2. `list_parse_server_versions`: what it can move to.
3. `plan_parse_server_upgrade` (with the target's `imageTag`, or none for the newest): what in the server code breaks, by file and line, how to change each, what SashiDo handles, and the steps. It reads the code and changes nothing.

Across several major versions the plan can be long. Don't skip versions blindly: read every item.

## 2. Show the plan

Say what you found in three parts and ask for one "yes":

- what must change in the server code, and how many places;
- what may change for the client apps (SDK versions, behaviour the migration guides name), which the plan can't see in the server code: mobile apps already installed on phones keep their old SDK, so say what that means for them;
- what you will do, in order, and how to go back.

If the plan found nothing to change, say so, and still do steps 4 to 6.

## 3. Fix the code first, on the current version

1. Change each place in the app's server code repository. Prefer the form that works on both versions.
2. Push; `wait_for_deployment`; `check_app_health`; `get_error_logs` for new errors.
3. Run `plan_parse_server_upgrade` again: it should now find nothing that breaks.

If the repository is not in the workspace, you can't do this step: give the person the list of changes by file and line, and stop before step 4 until the code is deployed.

## 4. Optional: try it on a second app

For an app with real users, offer to try the new version first on a second app with the same data model: `create_app` on the target version, recreate the classes from `list_classes` with `create_class` and their permissions, deploy the same server code to it, and exercise the main functions with `call_cloud_function`. A second app counts toward the plan and has no data: say both, and let the person decide. For a small or new app, skip it.

## 5. Switch the version

1. `change_parse_server_version` without `confirm`: it shows what would change. Show that to the person.
2. After their "yes", call it with `confirm: true`. Ask even when the plan found nothing to change and even though they asked for the upgrade: the request is not the "yes" to this preview, and a major version also changes things for their client apps.
3. The switch builds the app with the new version and then deploys it. It takes several minutes, and in between a deployment with the old version may serve. `wait_for_deployment` with `after` and `version`, as the tool says, and call it again each time it answers "not done yet". Don't check anything else until it says the app reports the new version.

## 6. Verify

- `check_app_health`: it must report the new version. If it still reports the old one, the switch is not finished: go back to waiting, and say nothing is wrong yet.
- `get_error_logs`: nothing new since the switch. Look again after about ten minutes of real traffic.
- `get_process_metrics`: no restarts, memory and CPU as before.
- Errors such as HTTP 502 from the app's own checks while the switch is still rolling out mean the app is restarting, not that something is broken. Wait and try again before reporting them.
- `get_app_advice`: on newer versions it runs more checks than before, and may report things that were always there. Report them as "should fix", not as caused by the upgrade.

## 7. The way back

If something is wrong: `change_parse_server_version` to the previous `imageTag`, with the same preview and confirmation. Because the code was made to work on both versions, nothing else has to be undone. Do it when errors appear that you can't explain within a few minutes; investigate after.

## 8. Say what is true now

> **my-app runs Parse Server 8.**
> 4 places in the server code were changed first; the list is in the pull request.
> Healthy since the switch, no new errors in 10 minutes.
> The way back: switch the version to the previous one; the code works on both.
> Left for you: update the Parse SDK in the mobile app at its next release.
