# EdMat – User Story Checklist

## 3.1 Subject Teacher: Attendance, Grading, and Lesson Records

- [x] As a Subject Teacher, I want to register attendance for an ongoing lesson with a single click marking all students as present, and then change the status of selected individuals to absent, late, excused, or justified absence, to reduce recording time to under 30 seconds.
- [x] As a Subject Teacher, I want the system to prevent entering a partial grade for a student who has a confirmed absent status for a given lesson hour, unless I select the option to make up the work at a later date.
- [x] As a Subject Teacher, I want to link the entered lesson topic with the database of result plans and specific item numbers of the MEN core curriculum, verifying the degree of core curriculum implementation in real time.
- [x] As a Subject Teacher, I want to define a new grade category with an assigned weight from 1 to 10, a specific highlight color in the grade grid, and a default parameter deciding whether it is included in the weighted average.
- [x] As a Subject Teacher, I want to enter a partial grade with a plus or minus modifier and expect the mathematical engine to convert it according to the school weighting system to the correct fractional value when calculating the arithmetic or weighted average.
- [x] As a Subject Teacher, I want to enter a grade in points mode, expecting the system to automatically calculate the percentage and suggest the appropriate school grade according to the percentage scale defined in the configuration.
- [x] As a Subject Teacher, I want to issue a grade marked as unprepared or missing assignment, verifying that this entry does not distort the student's numerical weighted average, but is visible in statistical reports.
- [x] As a Subject Teacher, I want to insert a retake grade into an existing test score in such a way that both values are visible in the grade grid, and the average algorithm considers only the higher grade or calculates the average according to internal school grading regulations.
- [x] As a Subject Teacher, I want to bulk enter grades for an entire lab group using the numeric keypad with the cursor automatically moving to the next student upon pressing Enter.
- [x] As a Subject Teacher, I want to save a descriptive comment for an entered partial grade, visible to the parent and student, explaining the criteria of the errors made.
- [x] As a Subject Teacher, I want to revert an incorrectly issued grade or modify its category, ensuring that the system recorded this fact in the audit log along with the original value and reason for edit.
- [x] As a Subject Teacher conducting a combined lesson for two language groups, I want to have access to a combined attendance list while maintaining separate grade assignments to the gradebooks of the respective home classes.
- [x] As a Subject Teacher, I want to record a student's participation in an out-of-school subject competition via the representing school status, which does not lower their percentage attendance in the general classification.
- [x] As a Subject Teacher, I want to save the attendance status as a draft if the lesson was interrupted by an evacuation alarm, and then complete the entry later without losing data.
- [x] As a Subject Teacher, I want to record a student's tardiness with the exact number of minutes, obtaining an automatic status update in monthly statistics.
- [x] As a Subject Teacher in grades 1–3 of primary school, I want to enter a mid-year descriptive grade divided into defined development areas based on a predefined bank of pedagogical phrases.
- [x] As a Subject Teacher, I want to publish homework with a precisely specified due date, attachment size limit, and the option to block work submission after the designated date and time.
- [x] As a Subject Teacher, I want to evaluate homework submitted in document or image format directly in the browser window using an embedded review tool without needing to download the file to the local computer drive.
- [x] As a Subject Teacher, I want to schedule an announced written test in the class timetable, receiving an immediate system warning if the test limit specified in the school regulations has already been reached for that day or week.
- [x] As a Subject Teacher, I want to generate and print a grade and attendance record for a specified student for a planned individual meeting with their parents.
- [x] As a Subject Teacher, I want to enter a proposed mid-year or annual grade within the deadline specified in the calendar, checking whether the system automatically sent a notification to the parent's and student's account.
- [x] As a Subject Teacher, I want to lock the editing of partial grades for a given semester after the administrative deadline for closing classification set by the principal has passed.
- [x] As a Subject Teacher, I want to record a positive or negative remark from the lesson log, specifying whether the entry should result in modifying behavior points according to school rules.
- [x] As a Subject Teacher, I want to export a report of partial grades and attendance for the subject taught to a spreadsheet format while preserving data anonymization for exam analysis purposes.
- [x] As a Subject Teacher, I want to conduct a lesson in the offline mode of the mobile app in case of a network failure, expecting seamless synchronization of attendance entries and topics upon restoring internet connectivity.

## 3.2 Homeroom Teacher: Classification, Legal Documentation, and Certificate Generation

- [x] As a Homeroom Teacher, I want to access the class summary classification dashboard, presenting the status of all proposed and final grades across all subjects and warnings about predicted failing grades.
- [x] As a Homeroom Teacher, I want to issue mid-year and annual behavior grades, taking into account the total positive and negative points, overall attendance percentage, and remarks from other teachers teaching the class.
- [x] As a Homeroom Teacher, I want to verify the list of students at risk of not being promoted to the next grade due to over 50% unexcused absences in individual subjects.
- [x] As a Homeroom Teacher, I want to receive electronic absence excuse requests submitted by parents, verify attached reasons, and bulk approve or reject excuses with reasons provided for rejections.
- [x] As a Homeroom Teacher, I want to verify the correctness of grammatical declension of students' first names, last names, and places of birth in the locative case on the personal data sheet before generating certificates.
- [x] As a Homeroom Teacher, I want to generate digital report cards for all students in the class, ensuring the system automatically transferred annual grades, notes on the Pedagogical Council resolution, and honors promotion clause.
- [x] As a Homeroom Teacher, I want to enter grades earned by a student in previous years or at another school directly into the report card history view for a student transferred during the educational cycle.
- [x] As a Homeroom Teacher, I want to do a test print of a promotional certificate on blank A4 paper, then hold the print against the light to the original MEN blank form to verify the precise alignment of text margins and signature lines.
- [x] As a Homeroom Teacher, I want to batch export print-ready honors certificates to PDF for students meeting the requirement of a grade average of at least 4.75 and a very good or exemplary behavior grade.
- [x] As a Homeroom Teacher, I want to record special achievements of a student and check the parameter allowing their official entry on the school certificate in accordance with applicable education law.
- [x] As a Homeroom Teacher, I want to close the semester in the class logbook, locking subject teachers from making retroactive changes without formal consent from the administration.
- [x] As a Homeroom Teacher, I want to generate a monthly class attendance report detailing excused absences, unexcused absences, tardiness, and early dismissals for the monthly staff meeting.
- [x] As a Homeroom Teacher, I want to send a broadcast system message exclusively to members of the Class Parent Council with the agenda for the upcoming parent meeting attached.
- [x] As a Homeroom Teacher, I want to check read receipts from parents regarding notifications of potential failing annual grades 30 days prior to the classification meeting.
- [x] As a Homeroom Teacher, I want to assign roll call numbers to students at the beginning of the school year alphabetically, maintaining relational integrity if a new student joins during the school year.
- [x] As a Homeroom Teacher, I want to record in the system the removal of a student from the class roster based on an administrative decision with date and resolution number, archiving their achievements without permanent deletion from the database.
- [x] As a Homeroom Teacher, I want to print a complete logbook page with parent contact information in an emergency situation with an automatic GDPR confidentiality notice applied.
- [x] As a Homeroom Teacher, I want to manage cross-class groups, assigning my students to proper activity groups created in other classes.
- [x] As a Homeroom Teacher, I want to verify that for every conducted school day in the logbook, the correct number of lesson hours matching the approved curriculum plan has been recorded.
- [x] As a Homeroom Teacher, I want to submit the complete, digitally closed class logbook for formal approval by the school principal after the end of annual teaching activities.

## 3.3 School Principal and Management: Substitutions, Overtime, and Pedagogical Supervision

- [x] As a Principal, I want to register a sudden three-day sick leave of a physics teacher and trigger the automatic temporary substitute selection module for all lessons scheduled during this period.
- [x] As a Principal, I want the algorithm to suggest physics teachers with free periods first, related subject teachers second, and supervision duty teachers as a last resort.
- [x] As a Principal, I want to handle situations where an absent teacher's lesson is the first or last period for a class, allowing safe cancellation or rescheduling with parent notifications regarding schedule changes.
- [x] As a Principal, I want to approve combining two classes into one lesson period in the school auditorium and assign this cover to a single teacher with automatic recalculation of pay rates.
- [x] As a Principal, I want to publish the substitute schedule for the next day at a set time, ensuring changes are immediately reflected in the timetables of all affected students, teachers, and parents.
- [x] As a Principal, I want to define a monthly settlement period and generate a report on overtime hours and conducted temporary cover lessons for each teaching staff member in accordance with the Teacher's Charter.
- [x] As a Principal, I want to export the extra hours settlement statement in a format compatible with the school's HR and payroll system.
- [x] As a Principal, I want to run a comprehensive system audit verifying the completeness of lesson topics and attendance entries across all school classes for the past week, generating a list of discrepancies with teacher names.
- [x] As a Principal, I want to verify core curriculum completion across all subjects at the end of the semester, checking the completion percentage of planned thematic units.
- [x] As a Principal, I want to invalidate an incorrectly confirmed classification grade upon request of the appeals committee, entering a new grade obtained via verification exam along with attaching committee meeting minutes.
- [x] As a Principal, I want to assign acting homeroom teacher status to another teacher during an extended absence of the regular homeroom teacher while keeping full legal responsibility separation.
- [x] As a Principal, I want to publish a global announcement requiring read confirmation for all parents and staff, blocking other views until acknowledgment.
- [x] As a Principal, I want to review the work log of the psychologist and counselor, ensuring access to consultation statistics and support documents while restricting access to encrypted confidential notes.
- [x] As a Principal, I want to monitor school-wide test load on students to identify classes with regular test accumulation beyond statutory limits.
- [x] As a Principal, I want to approve a field trip plan submitted by the trip leader, automatically marking participating students as absent on trip in regular timetables and generating substitute assignments for chaperones.
- [x] As a Principal, I want to inspect the complete audit log, filtering events by IP address, date, user ID, and edit/delete operations on grades and attendance.
- [x] As a Principal, I want to generate an annual archive package of the e-logbook in XML and PDF format within 10 days after the end of the school year and sign it with a qualified electronic signature or electronic seal.
- [x] As a Principal, I want to block an employee's account immediately upon employment termination, revoking active sessions across web and mobile apps.
- [x] As a Principal, I want access to parent login statistics to identify households at risk of digital exclusion or lacking regular contact with the school.
- [x] As a Principal, I want to manage global visibility settings for grade averages and class rankings, preventing peer comparison on parent accounts according to school policy.

## 3.4 Counselor, Psychologist, and Psychological-Pedagogical Support Team: IPET, WOPFU, and Sensitive Data

- [x] As a School Psychologist, I want to create an Other Activities Log for students in social-emotional skills sessions, recording therapeutic goals and weekly meeting topics.
- [x] As a Special Educator, I want to initiate collaborative creation of the WOPFU document for a student with special education needs, inviting assigned class teachers to edit.
- [x] As a Special Educator, I want to prepare an IPET form, defining integrated teaching actions, psychological-pedagogical support forms, rehabilitation session hours, and external exam accommodations.
- [x] As a Psychologist, I want to save a confidential intervention session note in the specialist notes module, ensuring asymmetric encryption accessible only to me and an authorized replacement.
- [x] As a Psychologist, I want class data exports to XML by administration to exclude confidential therapy notes, including only formal attendance logs from the Other Activities Log.
- [x] As a Speech Therapist, I want to record an individual speech therapy session, logging attendance, articulation exercises, and home practice recommendations visible exclusively on the parent's account.
- [x] As a Support Teacher, I want to log daily implementation of IPET recommendations during subject lessons directly from the integrated class logbook view.
- [x] As a Counselor, I want to generate a periodic evaluation of psychological-pedagogical support effectiveness for a student at the end of semester 1 and export it to PDF for the team meeting.
- [x] As a Psychologist, I want to share only public psychological opinions or extracts from WOPFU/IPET with parents, excluding protected diagnostic test documentation.
- [x] As a Counselor, I want to record Blue Card procedure or probation supervision for a student's family in the incident log with strict database-level access restrictions.
- [x] As a Remedial Educator, I want to schedule compensatory learning sessions, ensuring the system flags time conflicts with mandatory student classes.
- [x] As a Counselor, I want to log a community interview with a social welfare worker, attaching a password-protected scan of the official cover letter.
- [x] As a Specialist, I want student IPET and WOPFU documentation to roll over automatically to the new school year with revision history.
- [x] As a Psychologist, I want to send an encrypted request to a subject teacher for a report on student classroom functioning for assessment board evaluation.
- [ ] As a Counselor, I want real-time monitoring of attendance rates for social-welfare students, receiving alerts if 3 consecutive days are missed without parent notification.

## 3.5 School Registrar and System Administration: Records, SIO Integration, and Security

- [x] As a School Registrar, I want to enter a new student into the Student Register, recording PESEL or passport details, birth date and place, and parent metadata with automatic PESEL checksum validation.
- [x] As a School Registrar, I want to generate and issue a digital student ID along with an authorization code for the government mObywatel app.
- [x] As a School Registrar, I want to generate an XML data package compliant with SIO technical specifications for error-free import of class structures and student counts.
- [x] As a School Administrator, I want to set up the new school year structure, defining terms, winter breaks, holiday breaks, and additional days off from classes.
- [x] As a School Administrator, I want to import a timetable grid from external scheduling software, ensuring group splits, room allocations, and teacher assignments are transferred correctly.
- [x] As a School Administrator, I want to reset a user password, forcing an immediate password change upon first login with complexity policy validation.
- [x] As a School Administrator, I want to configure TOTP-based two-factor authentication for all school staff authorized to edit grades and attendance.
- [x] As a School Registrar, I want to record a student transfer to another school, generating a report card transcript and closing their entry in the register with the departure date.
- [x] As a School Administrator, I want to manage messaging permissions, defining whether parents can contact all teachers or only assigned homeroom and subject teachers.
- [x] As a School Registrar, I want to batch print duplicate school certificates with annotations of duplicate issue date and administrative decision number.
- [x] As a School Administrator, I want to generate one-time registration codes for parents of first-grade students for easy account creation.
- [x] As a School Administrator, I want to configure network access rules and an IP whitelist for administrative logins.
- [x] As a School Administrator, I want to run personal data anonymization mechanisms on database backups used in test environments.
- [x] As a School Registrar, I want to register mandatory preschool preparation completion for local district children, verifying district register completeness.
- [x] As a School Administrator, I want to define a system log retention policy, ensuring legally required storage duration and immutability.

## 3.6 Student: Study Organization, Homework, and Student Rights

- [x] As a Student, I want to see a personalized dashboard upon login displaying today's timetable, upcoming tests, and homework due tomorrow.
- [x] As a Student, I want to check my partial grades by subject with weight, category color, and average, guaranteed that I cannot see peers' grades.
- [x] As a Student, I want to submit homework solutions as text files or smartphone photos, receiving a clear server receipt timestamp.
- [x] As a Student, I want to check my current attendance status for today's lessons to verify correct attendance recording.
- [x] As a Student, I want alerts about sudden lesson cancellations or room changes in advance to avoid waiting outside classrooms.
- [x] As a Student, I want to check upcoming test dates and material scopes in the monthly calendar to verify compliance with advance notice rules.
- [x] As a Student, I want to set educational goals in the progress module, receiving grade simulations required to achieve desired term grades.
- [x] As a Student, I want to download study materials and presentations shared by teachers directly from the lesson history.
- [x] As a Student, I want to message teachers about learning difficulties via internal chat without exposing private phone numbers or email addresses.
- [x] As a Student, I want free access to check schedules and grades in the mobile app without subscription micropayments.
- [x] As an Adult Student, I want permission to submit my own absence excuses, provided school regulations permit it.
- [x] As an Adult Student, I want to object to parent access to my grades and attendance, triggering immediate block on guardian accounts.
- [x] As a Student, I want library return deadline notifications for borrowed books prior to semester end.
- [x] As a Student, I want to switch the app interface to dark mode to reduce eye strain during evening homework checks.
- [x] As a Student, I want to navigate the logbook using dedicated keyboard shortcuts for full accessibility during temporary motor impairments.

## 3.7 Parent and Legal Guardian: Educational Oversight, e-Excuses, and Communication

- [x] As a Parent with children in different classes or schools, I want to log in with one email and seamlessly switch between children's profiles via Multi-account view.
- [ ] As a Parent, I want instant push notifications for first-period absences to immediately verify my child's safety.
- [x] As a Parent, I want to submit electronic absence excuse requests with reasons via the mobile app without subscription fees.
- [x] As a Parent, I want to track absence excuse request statuses with visible teacher comments in case of rejection.
- [x] As a Parent, I want to report planned future absences, automatically notifying homeroom and subject teachers.
- [x] As a Parent, I want permanent, free browser access to all grades, averages, comments, and attendance records of my child.
- [x] As a Parent, I want to configure night quiet mode to mute logbook notifications except administration crisis alerts.
- [x] As a Parent, I want to view class meetings and open days with appointment booking for teacher consultations.
- [x] As a Parent, I want to pay for school lunches or Parent Council fees directly via electronic payments with instant receipts.
- [x] As a Parent, I want to cancel same-day school lunch before morning cut-off, receiving automatic credit on next month's bill.
- [x] As a Parent, I want to send confidential messages to the school counselor inaccessible to other staff members.
- [x] As a Parent, I want to electronically sign field trip consent forms and regulations via mobile app authorization.
- [x] As a Divorced Parent with full custody rights, I want a separate account ensuring the other parent cannot view my correspondence or contact info.
- [x] As a Parent, I want formal failing grade warnings 30 days prior to classification with delivery receipt tracking.
- [x] As a Parent, I want to export child grade and attendance history to PDF at year end for personal archiving.

## 3.8 Complementary Modules: After-School Care, Cafeteria, Field Trips, and School Library

- [x] As an After-School Care Educator, I want to check students into after-school care using ID barcode scanners or quick roster checks.
- [x] As an After-School Care Educator, I want to verify authorized pickup lists and log exact pickup timestamps and identities.
- [x] As a Cafeteria Manager, I want daily meal count reports generated based on morning logbook attendance entries.
- [x] As a Cafeteria Manager, I want to block meal serving for overdue accounts while discreetly notifying parents via app.
- [x] As a Trip Leader, I want to create a digital Field Trip Sheet with schedules, roster, chaperone groups, and insurance details.
- [x] As a Trip Leader, I want trip approval to automatically assign field trip attendance status to participating students across lesson logs.
- [x] As a Classroom Teacher, I want lists of non-participating students from trip classes along with their temporary group assignments.
- [x] As a Librarian, I want to batch checkout textbook sets for whole classes in September using barcode scanners.
- [x] As a Librarian, I want to verify student material settlement statuses before issuing graduation certificates.
- [x] As a School Nurse, I want to record first aid medical visits with automatic health privacy restrictions.

## 3.9 Non-Functional Requirements: Digital Accessibility (WCAG 2.1 AA), GDPR, Performance, and Security

- [x] As a Blind User, I want to navigate grades and test schedules via screen reader, ensuring proper semantic headers and ARIA labels.
- [x] As a Visually Impaired User, I want high-contrast mode and 200% text magnification without interface distortion or horizontal scrolling.
- [x] As a Motor-Impaired User, I want complete keyboard navigation for recording attendance and lesson topics with visible focus indicators.
- [x] As a Hearing-Impaired User, I want instructional videos to feature accurate subtitles and text alternatives.
- [x] As a Teacher entering data in class, I want session timeout warnings after 15 minutes of inactivity followed by auto-logout for data security.
- [x] As a Data Administrator, I want all server connections encrypted via modern TLS with HSTS enforcement and secure session cookies.
- [x] As a Teacher, I want to open the logbook and record attendance in under 2 seconds during peak morning login hours without server downtime.
- [x] As a Mobile App User, I want assurance that software excludes commercial tracking libraries and third-party ad networks collecting telemetry on minors.
- [x] As a Data Protection Officer, I want to verify that deleting test accounts permanently removes personal data per the right to be forgotten while preserving technical audit logs.
- [x] As a User, I want a fully responsive web interface on mobile devices accessing 100% of platform features without paywalls encouraging native app purchases.

## 3.10 School Events: Open Days, Fêtes and Ceremonies (organiser side)

- [x] As an Event Organiser, I want to draft an event brief with its objective, a measurable outcome and the non-negotiable constraints, before any room or rota is planned.
- [x] As an Event Organiser, I want every event room planned by layout, so seated capacity, the accessibility buffer and the venue's fire limit are checked against the expected attendance.
- [x] As an Event Organiser, I want a shift rota per station that shows which shifts are still short of helpers.
- [x] As a Student Volunteer, I want to claim a shift only once my guardian's consent and the safety briefing are on record, so nobody starts a shift unprepared.
- [x] As a Safeguarding Lead, I want shifts for volunteers under 16 refused when they exceed the daily hour cap, fall into curfew hours, leave no rest gap, or have no adult on the same shift.
- [x] As an Event Organiser, I want briefing documents published in tiers, so parents, helpers and organisers each see only what their role needs.
- [x] As a Gate Volunteer, I want to scan visitor passes while the hall has no network, and have the queued scans settle when it returns.
- [x] As a Gate Volunteer, I want a re-scanned pass to report "already inside" and the same pass seen at two gates to report a collision, instead of silently admitting twice.
- [x] As a Catering Lead, I want headcount and allergen totals as aggregates only, so no attendee-level dietary list leaves the system.
- [x] As an Event Organiser, I want approval refused while any risk still scores in the unacceptable band of the register.
- [x] As an Event Organiser, I want a printable run sheet carrying the schedule, room capacities, staffing and the residual risks.
- [x] As a Data Protection Officer, I want event passes, scans and dietary records purged 30 days after the event while the aggregate counts survive.
