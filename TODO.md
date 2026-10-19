

## Inspector submission and admin PDF workflow

- [x] Inspectors are the only role that can start, edit, score, and finalize inspection checklists.
- [x] Completing an inspection submits the full facility metadata, checklist responses, remarks, gaps, and completion timestamp to the shared MySQL inspection register.
- [x] Admins cannot open the audit workspace, start inspections, edit responses, or access the checklist library; their dashboard is limited to submitted reports and inspector-account management.
- [x] Admins can open a submitted report in read-only mode and review section scores, gaps, severity markers, remarks, and visit notes.
- [x] Admins have a real Download PDF action backed by a server-generated PDF endpoint with the facility report, section results, assessment details, remarks, and notes.
- [x] End-to-end validation confirmed an inspector submission appears in the admin inbox and the PDF endpoint returns a valid multi-page PDF file.
