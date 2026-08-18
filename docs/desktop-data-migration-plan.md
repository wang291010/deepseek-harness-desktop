# Desktop data migration plan

## Source and destination

- Existing client source: `C:\Users\wang2\.dsh`
- New client destination: Electron `userData\harness-home`
- Current Windows display name: `DeepSeek Harness Desktop`

The destination is selected by the launcher at runtime. No migration should
assume its location from the display name alone; the first development launch
must report and verify Electron's actual `userData` path.

## Safety order

1. Build an unpacked development application without replacing the installed
   DSH Desktop.
2. Start the new application once with the private Harness home and verify the
   exact source and destination paths are different.
3. Close both applications completely.
4. Create a read-only backup snapshot of the old `.dsh` directory.
5. Inventory conversations, credentials, profiles, plugins, and caches before
   deciding which categories can be copied directly.
6. Copy reviewed data into the private destination. Never move it and never
   delete the source during migration.
7. Reapply restrictive credential permissions at the destination.
8. Test conversations, projects, plugins, usage data, and one real model reply.
9. Keep the old client and snapshot until the new client has been stable for an
   agreed observation period.
10. Uninstall the old application only after an explicit final confirmation.

## Current state

The launcher isolation is implemented and covered by the Windows release gate.
No old user data has been copied, moved, or deleted yet.
