# Privacy Policy

_Last updated: 2026-07-28_

deck is a local tool. It runs on your computer, reads and writes files on your disk, and has no server component. There is no deck account, no deck backend, and nothing to sign in to.

## What is collected

**Nothing.** deck has no telemetry, no analytics, no crash reporting, and no usage tracking. It does not phone home. The author receives no data about you, your decks, or your use of the software.

## What it reads and writes

deck only touches the folder you point it at, and the folders beneath it:

| What | Where |
| --- | --- |
| Your decks | `<decks folder>/*.md` |
| Annotations you draw | `<decks folder>/.ink/<deck>.json` |
| Images you paste onto a slide | `<decks folder>/images/` |
| PNGs you export | `exports/` |

If you set the optional image folder (`ASSET_ROOT`), deck will additionally **read** image files by name from anywhere beneath that folder, so an embed like `![[shot.png]]` resolves. It never writes outside the decks folder.

deck never deletes a deck.

## Network

deck makes **no outbound network requests**. Fonts are bundled with the application rather than fetched, so the viewer works with no internet connection at all.

The viewer is a local web server bound to `127.0.0.1` (localhost) by default, reachable only from your own machine. If you override this with `--host`, you are choosing to expose it on your network; that is your decision and its consequences are yours.

## Third parties

deck shares your data with no one, because it sends your data nowhere.

One thing worth understanding: when you use deck **through an AI client** such as Claude, and you ask that client to read or write a deck, the deck's contents pass through that client and its model provider. That is the client doing what you asked it to do, under its own privacy policy. deck itself is only reading and writing your local files. Anything you never ask an assistant to open stays on your disk and is never seen by anyone.

## Retention

Your files are yours and remain on your disk until you move or delete them. deck retains nothing, because it stores nothing outside those files. Uninstalling deck leaves your decks exactly where they are.

## Children

deck is a developer tool and is not directed at children.

## Changes

Any change to this policy will be committed to [the repository](https://github.com/bassotov/deck) with its date, and the history is public.

## Status of this project

deck is a personal open-source project, not a commercial product. It is free, there is no company behind it, and nothing is sold. Installing it is your own choice, and it is provided as is, without warranty, under the [MIT License](LICENSE). See the disclaimer in the [README](README.md#disclaimer).

## Contact

Questions or concerns: open an issue at <https://github.com/bassotov/deck/issues>.
