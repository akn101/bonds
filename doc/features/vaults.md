# Vaults

Vaults are isolated containers that hold contacts and their associated data. They provide secure data separation and access control for multi-user setups.

## Why Vaults?

- **Data isolation**: Contacts in different vaults are separate, with the exception of [cross-vault relationships](/features/contacts#cross-vault-relationships).
- **Shared access**: Invite other users to collaborate on the same vault.
- **Role-based permissions**: Control who can do what.

## Roles

Each user in a vault has one of three roles:

| Role | Permissions |
|------|-------------|
| **Manager** | Full access: create, edit, delete contacts and vault settings. Can invite others. |
| **Editor** | Can create and edit contacts, but cannot manage vault settings or users. |
| **Viewer** | Read-only access to contacts. Cannot modify anything. |

## Creating a Vault

After logging in, create your first vault from the dashboard. Give it a name and optional description. The creator automatically becomes the **Manager**.

## Vault-level Settings

Each vault has its own set of defaults, seeded on creation:

- **Important date types**: Birthdate, deceased date (built-in), plus custom types.
- **Mood tracking parameters**: 5-level mood scale with emoji and colors.
- **Activity categories**: 4 categories with 20 activity types.
- **Quick facts templates**: How we met, hobbies, food preferences.

## System Users and Contacts

Vault members and contacts are independent concepts. Joining or creating a vault never creates a contact for the system user.
- **Membership and permissions**: `UserVault` only links a system user to a vault and stores their role.
- **Mood recording**: Mood entries belong directly to the current system user within the vault.
- **Activities**: Activities created from the dashboard store the system user as their subject. Optional participants are ordinary contacts and are the only activities shown on contact timelines.

## Vault Dashboard

The main workspace in a vault is a responsive three-column dashboard:

### Left Column
Displays your **Recent Contacts** and **Most Consulted** contacts for quick access. This column is hidden on small tablet screens.

### Center Column
Features a Segmented control to switch between three dynamic tabs. Your selected tab is persisted through `default-dashboard-tab`, loading your preferred tab automatically on next visit.
1. **Feed**: Recent changes and actions taken by users in this vault.
2. **Activities**: An overview of all activities in the vault. Dashboard-created activities identify the creating system user as their subject and can include optional contact participants; those activities also appear on each participant's contact timeline.
3. **Life Metrics**: Simple event logs tracking custom metrics. Click "+1" to log an occurrence. Click details to view a monthly bar chart of recorded events.

### Right Column
Contains widgets for:
- **Mood Recording**: Log your mood on a five-point scale. The entry is scoped to your system user and the current vault.
- **Upcoming Reminders**: Reminders coming up in the near future.
- **Due Tasks**: Open tasks requiring your attention.

## Life Metrics Architecture

Rather than attaching numbers directly to contacts, Life Metrics use an event-log pattern. Clicking "+1" records a new timestamped event entry in the database. Monthly statistics count these logs to render bar charts on the metric details page.

## Inviting Users

Vault managers can invite other users to join the vault through the User Invitations system. Each invitation specifies a permission level.

## Switching Vaults

If you have access to multiple vaults, use the vault switcher in the navigation bar to move between them. Each vault maintains its own contact list, settings, and search index.
