// Prebuilt module templates — the starter catalog the coach draws on during
// onboarding to build each user a tailored Helm (instead of a fixed set).
//
// Each template is a plain module definition the generic system already
// understands: a label + icon + a constrained field-spec schema
// ({ key, label, type: text|number|bool|date|select, options?, required? }).
// `tags` help the coach match a template to a user's vision/goals.
// `pairs_with` names an external tool that can feed the module once connected
// (via Library -> Connections) — the module works standalone without it.
//
// This is read-only reference data: served at GET /api/module-templates and
// instantiated by create_module / create_module_from_template. Nothing here
// is user data.

export const MODULE_TEMPLATE_GROUPS = [
  'Health', 'Mind', 'Work', 'Money', 'Growth', 'People', 'Home', 'Passions',
];

export const MODULE_TEMPLATES = [
  // ---------------- Health & Body ----------------
  {
    key: 'sleep_log', label: 'Sleep log', group: 'Health', icon: '😴',
    description: 'Track how long and how well you slept.',
    tags: ['health', 'sleep', 'recovery', 'energy'], pairs_with: 'Oura / Whoop / Apple Health',
    schema: [
      { key: 'date', label: 'Date', type: 'date', required: true },
      { key: 'hours', label: 'Hours slept', type: 'number' },
      { key: 'quality', label: 'Quality', type: 'select', options: ['poor', 'ok', 'good', 'great'] },
      { key: 'notes', label: 'Notes', type: 'text' },
    ],
  },
  {
    key: 'supplements', label: 'Supplements & meds', group: 'Health', icon: '💊',
    description: 'What you take, when, and whether you took it.',
    tags: ['health', 'medication', 'routine'], pairs_with: null,
    schema: [
      { key: 'name', label: 'Name', type: 'text', required: true },
      { key: 'dose', label: 'Dose', type: 'text' },
      { key: 'time', label: 'Time of day', type: 'select', options: ['morning', 'midday', 'evening', 'night'] },
      { key: 'taken', label: 'Taken today', type: 'bool' },
    ],
  },
  {
    key: 'symptom_journal', label: 'Symptom journal', group: 'Health', icon: '🩺',
    description: 'Log symptoms, severity and possible triggers over time.',
    tags: ['health', 'medical', 'chronic'], pairs_with: null,
    schema: [
      { key: 'date', label: 'Date', type: 'date', required: true },
      { key: 'symptom', label: 'Symptom', type: 'text', required: true },
      { key: 'severity', label: 'Severity', type: 'select', options: ['mild', 'moderate', 'severe'] },
      { key: 'trigger', label: 'Possible trigger', type: 'text' },
      { key: 'notes', label: 'Notes', type: 'text' },
    ],
  },
  {
    key: 'body_measurements', label: 'Body measurements', group: 'Health', icon: '📏',
    description: 'Weight, waist and other measurements over time.',
    tags: ['health', 'fitness', 'weight', 'body'], pairs_with: 'Apple Health / smart scale',
    schema: [
      { key: 'date', label: 'Date', type: 'date', required: true },
      { key: 'weight_kg', label: 'Weight (kg)', type: 'number' },
      { key: 'waist_cm', label: 'Waist (cm)', type: 'number' },
      { key: 'body_fat_pct', label: 'Body fat %', type: 'number' },
      { key: 'notes', label: 'Notes', type: 'text' },
    ],
  },
  {
    key: 'water_intake', label: 'Water intake', group: 'Health', icon: '💧',
    description: 'Daily hydration count.',
    tags: ['health', 'hydration', 'habit'], pairs_with: null,
    schema: [
      { key: 'date', label: 'Date', type: 'date', required: true },
      { key: 'glasses', label: 'Glasses', type: 'number', required: true },
      { key: 'note', label: 'Note', type: 'text' },
    ],
  },
  {
    key: 'cycle_tracker', label: 'Cycle tracker', group: 'Health', icon: '🌙',
    description: 'Menstrual cycle phases, flow and symptoms.',
    tags: ['health', 'cycle', 'women'], pairs_with: null,
    schema: [
      { key: 'date', label: 'Date', type: 'date', required: true },
      { key: 'phase', label: 'Phase', type: 'select', options: ['period', 'follicular', 'ovulation', 'luteal'] },
      { key: 'flow', label: 'Flow', type: 'select', options: ['none', 'light', 'medium', 'heavy'] },
      { key: 'symptoms', label: 'Symptoms', type: 'text' },
    ],
  },
  {
    key: 'blood_pressure', label: 'Blood pressure', group: 'Health', icon: '❤️',
    description: 'Systolic / diastolic / pulse readings.',
    tags: ['health', 'medical', 'heart'], pairs_with: null,
    schema: [
      { key: 'date', label: 'Date', type: 'date', required: true },
      { key: 'systolic', label: 'Systolic', type: 'number', required: true },
      { key: 'diastolic', label: 'Diastolic', type: 'number', required: true },
      { key: 'pulse', label: 'Pulse', type: 'number' },
    ],
  },
  {
    key: 'energy_levels', label: 'Energy levels', group: 'Health', icon: '🔋',
    description: 'Rate your energy through the day to spot patterns.',
    tags: ['health', 'energy', 'mood'], pairs_with: null,
    schema: [
      { key: 'date', label: 'Date', type: 'date', required: true },
      { key: 'part_of_day', label: 'Part of day', type: 'select', options: ['morning', 'afternoon', 'evening'] },
      { key: 'energy', label: 'Energy (1-10)', type: 'number' },
      { key: 'note', label: 'What affected it', type: 'text' },
    ],
  },
  {
    key: 'appointments', label: 'Appointments & results', group: 'Health', icon: '🗓️',
    description: 'Medical appointments and what came out of them.',
    tags: ['health', 'medical', 'admin'], pairs_with: 'Google Calendar',
    schema: [
      { key: 'date', label: 'Date', type: 'date', required: true },
      { key: 'who', label: 'Doctor / clinic', type: 'text', required: true },
      { key: 'reason', label: 'Reason', type: 'text' },
      { key: 'outcome', label: 'Outcome / notes', type: 'text' },
      { key: 'follow_up', label: 'Needs follow-up', type: 'bool' },
    ],
  },
  {
    key: 'runs', label: 'Runs & rides', group: 'Health', icon: '🏃',
    description: 'Cardio sessions outside the gym — runs, rides, swims.',
    tags: ['health', 'fitness', 'cardio', 'running'], pairs_with: 'Strava',
    schema: [
      { key: 'date', label: 'Date', type: 'date', required: true },
      { key: 'type', label: 'Type', type: 'select', options: ['run', 'ride', 'swim', 'walk', 'other'] },
      { key: 'distance_km', label: 'Distance (km)', type: 'number' },
      { key: 'minutes', label: 'Minutes', type: 'number' },
      { key: 'how_it_felt', label: 'How it felt', type: 'text' },
    ],
  },

  // ---------------- Mind & Mood ----------------
  {
    key: 'mood_log', label: 'Mood log', group: 'Mind', icon: '🙂',
    description: 'A quick daily read on your mood and what drove it.',
    tags: ['mind', 'mood', 'mental-health', 'wellbeing'], pairs_with: null,
    schema: [
      { key: 'date', label: 'Date', type: 'date', required: true },
      { key: 'mood', label: 'Mood', type: 'select', options: ['awful', 'low', 'ok', 'good', 'great'] },
      { key: 'energy', label: 'Energy (1-10)', type: 'number' },
      { key: 'note', label: "What's behind it", type: 'text' },
    ],
  },
  {
    key: 'gratitude', label: 'Gratitude journal', group: 'Mind', icon: '🙏',
    description: 'A few things you were grateful for each day.',
    tags: ['mind', 'gratitude', 'wellbeing', 'journal'], pairs_with: null,
    schema: [
      { key: 'date', label: 'Date', type: 'date', required: true },
      { key: 'grateful_for', label: 'Grateful for', type: 'text', required: true },
      { key: 'why', label: 'Why it mattered', type: 'text' },
    ],
  },
  {
    key: 'meditation', label: 'Meditation & breathwork', group: 'Mind', icon: '🧘',
    description: 'Track your practice and how it left you feeling.',
    tags: ['mind', 'meditation', 'calm', 'habit'], pairs_with: null,
    schema: [
      { key: 'date', label: 'Date', type: 'date', required: true },
      { key: 'minutes', label: 'Minutes', type: 'number' },
      { key: 'style', label: 'Style', type: 'select', options: ['breath', 'body scan', 'loving-kindness', 'guided', 'silent'] },
      { key: 'after', label: 'How you felt after', type: 'text' },
    ],
  },
  {
    key: 'therapy_notes', label: 'Therapy notes', group: 'Mind', icon: '🛋️',
    description: 'Takeaways and homework from sessions.',
    tags: ['mind', 'therapy', 'mental-health'], pairs_with: null,
    schema: [
      { key: 'date', label: 'Date', type: 'date', required: true },
      { key: 'theme', label: 'Theme', type: 'text' },
      { key: 'insight', label: 'Key insight', type: 'text' },
      { key: 'homework', label: 'Homework', type: 'text' },
    ],
  },
  {
    key: 'journal', label: 'Daily journal', group: 'Mind', icon: '📓',
    description: 'A free-form daily entry.',
    tags: ['mind', 'journal', 'reflection', 'writing'], pairs_with: null,
    schema: [
      { key: 'date', label: 'Date', type: 'date', required: true },
      { key: 'entry', label: 'Entry', type: 'text', required: true },
      { key: 'mood', label: 'Mood', type: 'select', options: ['low', 'ok', 'good', 'great'] },
    ],
  },
  {
    key: 'triggers', label: 'Triggers & coping', group: 'Mind', icon: '🌀',
    description: 'Spot what sets you off and what actually helps.',
    tags: ['mind', 'anxiety', 'mental-health', 'cbt'], pairs_with: null,
    schema: [
      { key: 'date', label: 'Date', type: 'date', required: true },
      { key: 'trigger', label: 'Trigger', type: 'text', required: true },
      { key: 'reaction', label: 'How you reacted', type: 'text' },
      { key: 'what_helped', label: 'What helped', type: 'text' },
    ],
  },
  {
    key: 'wins', label: 'Wins & proud moments', group: 'Mind', icon: '🏆',
    description: 'Bank the small wins so progress feels real.',
    tags: ['mind', 'confidence', 'motivation', 'wins'], pairs_with: null,
    schema: [
      { key: 'date', label: 'Date', type: 'date', required: true },
      { key: 'win', label: 'Win', type: 'text', required: true },
      { key: 'why_it_counts', label: 'Why it counts', type: 'text' },
    ],
  },

  // ---------------- Career & Work ----------------
  {
    key: 'clients', label: 'Clients & projects', group: 'Work', icon: '💼',
    description: 'Who you work with and where each project stands.',
    tags: ['work', 'freelance', 'business', 'clients'], pairs_with: 'Notion / Linear',
    schema: [
      { key: 'name', label: 'Client / project', type: 'text', required: true },
      { key: 'status', label: 'Status', type: 'select', options: ['lead', 'active', 'paused', 'done'] },
      { key: 'value', label: 'Value', type: 'number' },
      { key: 'next_step', label: 'Next step', type: 'text' },
      { key: 'due', label: 'Due', type: 'date' },
    ],
  },
  {
    key: 'job_search', label: 'Job search pipeline', group: 'Work', icon: '🧭',
    description: 'Track applications from applied to offer.',
    tags: ['work', 'career', 'job-search'], pairs_with: 'Gmail',
    schema: [
      { key: 'company', label: 'Company', type: 'text', required: true },
      { key: 'role', label: 'Role', type: 'text' },
      { key: 'stage', label: 'Stage', type: 'select', options: ['to-apply', 'applied', 'interview', 'offer', 'rejected'] },
      { key: 'next_step', label: 'Next step', type: 'text' },
      { key: 'date', label: 'Last update', type: 'date' },
    ],
  },
  {
    key: 'networking', label: 'People I met', group: 'Work', icon: '🤝',
    description: 'Remember who you met and follow up on time.',
    tags: ['work', 'networking', 'relationships'], pairs_with: 'Gmail / LinkedIn',
    schema: [
      { key: 'name', label: 'Name', type: 'text', required: true },
      { key: 'where', label: 'Where you met', type: 'text' },
      { key: 'about', label: 'What they do / notes', type: 'text' },
      { key: 'follow_up_by', label: 'Follow up by', type: 'date' },
      { key: 'done', label: 'Followed up', type: 'bool' },
    ],
  },
  {
    key: 'deep_work', label: 'Deep-work sessions', group: 'Work', icon: '🎯',
    description: 'Log focused blocks to protect your best hours.',
    tags: ['work', 'focus', 'productivity'], pairs_with: null,
    schema: [
      { key: 'date', label: 'Date', type: 'date', required: true },
      { key: 'focus', label: 'What you worked on', type: 'text', required: true },
      { key: 'minutes', label: 'Minutes', type: 'number' },
      { key: 'rating', label: 'Focus (1-10)', type: 'number' },
    ],
  },
  {
    key: 'meeting_notes', label: 'Meeting notes', group: 'Work', icon: '🗒️',
    description: 'Decisions and actions from meetings.',
    tags: ['work', 'meetings', 'notes'], pairs_with: 'Google Calendar',
    schema: [
      { key: 'date', label: 'Date', type: 'date', required: true },
      { key: 'title', label: 'Meeting', type: 'text', required: true },
      { key: 'decisions', label: 'Decisions', type: 'text' },
      { key: 'actions', label: 'My actions', type: 'text' },
    ],
  },
  {
    key: 'idea_vault', label: 'Idea vault', group: 'Work', icon: '💡',
    description: 'Capture ideas before they vanish.',
    tags: ['work', 'ideas', 'creativity', 'business'], pairs_with: 'Notion',
    schema: [
      { key: 'idea', label: 'Idea', type: 'text', required: true },
      { key: 'category', label: 'Category', type: 'text' },
      { key: 'excitement', label: 'Excitement (1-10)', type: 'number' },
      { key: 'date', label: 'Captured', type: 'date' },
    ],
  },
  {
    key: 'skills_dev', label: "Skills I'm building", group: 'Work', icon: '🛠️',
    description: 'Track skills you are deliberately leveling up.',
    tags: ['work', 'growth', 'skills', 'learning'], pairs_with: null,
    schema: [
      { key: 'skill', label: 'Skill', type: 'text', required: true },
      { key: 'level', label: 'Level', type: 'select', options: ['beginner', 'improving', 'solid', 'strong'] },
      { key: 'practice', label: 'How I practice it', type: 'text' },
    ],
  },
  {
    key: 'brag_doc', label: 'Brag doc', group: 'Work', icon: '🌟',
    description: 'Achievements for reviews, raises and your CV.',
    tags: ['work', 'career', 'achievements'], pairs_with: null,
    schema: [
      { key: 'date', label: 'Date', type: 'date', required: true },
      { key: 'achievement', label: 'Achievement', type: 'text', required: true },
      { key: 'impact', label: 'Impact / result', type: 'text' },
    ],
  },
  {
    key: 'content_pipeline', label: 'Content pipeline', group: 'Work', icon: '✍️',
    description: 'Plan posts, videos and articles from idea to published.',
    tags: ['work', 'content', 'creator', 'marketing'], pairs_with: null,
    schema: [
      { key: 'title', label: 'Title / hook', type: 'text', required: true },
      { key: 'platform', label: 'Platform', type: 'select', options: ['x', 'instagram', 'youtube', 'tiktok', 'blog', 'newsletter'] },
      { key: 'status', label: 'Status', type: 'select', options: ['idea', 'drafting', 'scheduled', 'published'] },
      { key: 'publish_on', label: 'Publish on', type: 'date' },
    ],
  },

  // ---------------- Money & Finance ----------------
  {
    key: 'expenses', label: 'Expenses', group: 'Money', icon: '🧾',
    description: 'Log spending to see where it actually goes.',
    tags: ['money', 'budget', 'spending'], pairs_with: 'Bank / budgeting app',
    schema: [
      { key: 'date', label: 'Date', type: 'date', required: true },
      { key: 'item', label: 'Item', type: 'text', required: true },
      { key: 'amount', label: 'Amount', type: 'number', required: true },
      { key: 'category', label: 'Category', type: 'select', options: ['food', 'transport', 'home', 'fun', 'health', 'subscriptions', 'other'] },
    ],
  },
  {
    key: 'subscriptions', label: 'Subscriptions', group: 'Money', icon: '🔁',
    description: 'Every recurring charge in one place.',
    tags: ['money', 'budget', 'subscriptions'], pairs_with: null,
    schema: [
      { key: 'name', label: 'Service', type: 'text', required: true },
      { key: 'amount', label: 'Amount', type: 'number' },
      { key: 'cycle', label: 'Billing', type: 'select', options: ['monthly', 'yearly', 'weekly'] },
      { key: 'renews', label: 'Renews on', type: 'date' },
      { key: 'keep', label: 'Worth keeping', type: 'bool' },
    ],
  },
  {
    key: 'savings_goals', label: 'Savings goals', group: 'Money', icon: '🐖',
    description: 'What you are saving for and how close you are.',
    tags: ['money', 'savings', 'goals'], pairs_with: null,
    schema: [
      { key: 'goal', label: 'Goal', type: 'text', required: true },
      { key: 'target', label: 'Target amount', type: 'number' },
      { key: 'saved', label: 'Saved so far', type: 'number' },
      { key: 'by', label: 'Target date', type: 'date' },
    ],
  },
  {
    key: 'net_worth', label: 'Net-worth snapshots', group: 'Money', icon: '📈',
    description: 'A monthly snapshot of assets minus debts.',
    tags: ['money', 'wealth', 'investing'], pairs_with: null,
    schema: [
      { key: 'date', label: 'Date', type: 'date', required: true },
      { key: 'assets', label: 'Assets', type: 'number' },
      { key: 'debts', label: 'Debts', type: 'number' },
      { key: 'note', label: 'Note', type: 'text' },
    ],
  },
  {
    key: 'invoices', label: 'Invoices', group: 'Money', icon: '📑',
    description: 'Who owes you and whether they have paid.',
    tags: ['money', 'freelance', 'business'], pairs_with: 'Stripe',
    schema: [
      { key: 'client', label: 'Client', type: 'text', required: true },
      { key: 'amount', label: 'Amount', type: 'number', required: true },
      { key: 'sent', label: 'Sent on', type: 'date' },
      { key: 'status', label: 'Status', type: 'select', options: ['draft', 'sent', 'paid', 'overdue'] },
    ],
  },
  {
    key: 'bills', label: 'Bills & due dates', group: 'Money', icon: '📆',
    description: 'Never miss a payment.',
    tags: ['money', 'admin', 'bills'], pairs_with: null,
    schema: [
      { key: 'name', label: 'Bill', type: 'text', required: true },
      { key: 'amount', label: 'Amount', type: 'number' },
      { key: 'due', label: 'Due date', type: 'date' },
      { key: 'paid', label: 'Paid', type: 'bool' },
    ],
  },

  // ---------------- Learning & Growth ----------------
  {
    key: 'reading_list', label: 'Reading list', group: 'Growth', icon: '📚',
    description: 'Books to read, reading, and finished — with ratings.',
    tags: ['growth', 'reading', 'books', 'learning'], pairs_with: 'Readwise / Goodreads',
    schema: [
      { key: 'title', label: 'Title', type: 'text', required: true },
      { key: 'author', label: 'Author', type: 'text' },
      { key: 'status', label: 'Status', type: 'select', options: ['to-read', 'reading', 'done', 'abandoned'] },
      { key: 'rating', label: 'Rating (1-5)', type: 'number' },
    ],
  },
  {
    key: 'courses', label: 'Courses & learning', group: 'Growth', icon: '🎓',
    description: 'Courses you are taking and your progress.',
    tags: ['growth', 'learning', 'courses', 'skills'], pairs_with: null,
    schema: [
      { key: 'title', label: 'Course', type: 'text', required: true },
      { key: 'platform', label: 'Platform', type: 'text' },
      { key: 'status', label: 'Status', type: 'select', options: ['to-start', 'in-progress', 'done'] },
      { key: 'progress_pct', label: 'Progress %', type: 'number' },
    ],
  },
  {
    key: 'highlights', label: 'Highlights & notes', group: 'Growth', icon: '🖍️',
    description: 'Save the lines worth keeping from what you read.',
    tags: ['growth', 'reading', 'notes'], pairs_with: 'Readwise',
    schema: [
      { key: 'source', label: 'Book / article', type: 'text', required: true },
      { key: 'highlight', label: 'Highlight', type: 'text', required: true },
      { key: 'my_note', label: 'My note', type: 'text' },
    ],
  },
  {
    key: 'languages', label: 'Language practice', group: 'Growth', icon: '🗣️',
    description: 'Track study sessions and new vocabulary.',
    tags: ['growth', 'language', 'learning'], pairs_with: null,
    schema: [
      { key: 'date', label: 'Date', type: 'date', required: true },
      { key: 'language', label: 'Language', type: 'text' },
      { key: 'minutes', label: 'Minutes', type: 'number' },
      { key: 'learned', label: 'What you learned', type: 'text' },
    ],
  },
  {
    key: 'quotes', label: 'Quotes I love', group: 'Growth', icon: '❝',
    description: 'A collection of lines that move you.',
    tags: ['growth', 'inspiration', 'quotes'], pairs_with: null,
    schema: [
      { key: 'quote', label: 'Quote', type: 'text', required: true },
      { key: 'who', label: 'Who said it', type: 'text' },
      { key: 'why', label: 'Why it lands', type: 'text' },
    ],
  },
  {
    key: 'podcasts', label: 'Podcasts & talks', group: 'Growth', icon: '🎧',
    description: 'What you listened to and the one takeaway.',
    tags: ['growth', 'learning', 'podcasts'], pairs_with: 'Spotify',
    schema: [
      { key: 'title', label: 'Episode', type: 'text', required: true },
      { key: 'show', label: 'Show', type: 'text' },
      { key: 'takeaway', label: 'Takeaway', type: 'text' },
      { key: 'date', label: 'Date', type: 'date' },
    ],
  },

  // ---------------- Relationships & People ----------------
  {
    key: 'people', label: 'People I care about', group: 'People', icon: '👥',
    description: 'Stay close to the people who matter — last contact and what is going on with them.',
    tags: ['people', 'relationships', 'family', 'friends'], pairs_with: 'Google Contacts',
    schema: [
      { key: 'name', label: 'Name', type: 'text', required: true },
      { key: 'relationship', label: 'Relationship', type: 'text' },
      { key: 'last_contact', label: 'Last contact', type: 'date' },
      { key: 'whats_up', label: "What's going on with them", type: 'text' },
    ],
  },
  {
    key: 'gifts', label: 'Gift ideas', group: 'People', icon: '🎁',
    description: 'Capture gift ideas the moment they strike.',
    tags: ['people', 'gifts', 'relationships'], pairs_with: null,
    schema: [
      { key: 'person', label: 'For whom', type: 'text', required: true },
      { key: 'idea', label: 'Idea', type: 'text', required: true },
      { key: 'occasion', label: 'Occasion', type: 'text' },
      { key: 'bought', label: 'Bought', type: 'bool' },
    ],
  },
  {
    key: 'important_dates', label: 'Birthdays & anniversaries', group: 'People', icon: '🎂',
    description: 'The dates you never want to forget.',
    tags: ['people', 'dates', 'relationships'], pairs_with: 'Google Calendar',
    schema: [
      { key: 'name', label: 'Name', type: 'text', required: true },
      { key: 'occasion', label: 'Occasion', type: 'select', options: ['birthday', 'anniversary', 'other'] },
      { key: 'date', label: 'Date', type: 'date', required: true },
    ],
  },
  {
    key: 'date_ideas', label: 'Date & hangout ideas', group: 'People', icon: '💞',
    description: 'A running list of things to do together.',
    tags: ['people', 'relationships', 'fun', 'couple'], pairs_with: null,
    schema: [
      { key: 'idea', label: 'Idea', type: 'text', required: true },
      { key: 'with_whom', label: 'With', type: 'text' },
      { key: 'vibe', label: 'Vibe', type: 'select', options: ['chill', 'adventure', 'fancy', 'cheap'] },
      { key: 'done', label: 'Done', type: 'bool' },
    ],
  },

  // ---------------- Home & Life Admin ----------------
  {
    key: 'home_maintenance', label: 'Home maintenance', group: 'Home', icon: '🔧',
    description: 'Recurring home jobs so nothing rots quietly.',
    tags: ['home', 'admin', 'maintenance'], pairs_with: null,
    schema: [
      { key: 'task', label: 'Task', type: 'text', required: true },
      { key: 'area', label: 'Area', type: 'text' },
      { key: 'last_done', label: 'Last done', type: 'date' },
      { key: 'next_due', label: 'Next due', type: 'date' },
    ],
  },
  {
    key: 'meal_plan', label: 'Meal plan', group: 'Home', icon: '🍽️',
    description: 'Plan the week so shopping and cooking get easier.',
    tags: ['home', 'food', 'planning'], pairs_with: null,
    schema: [
      { key: 'date', label: 'Date', type: 'date', required: true },
      { key: 'meal', label: 'Meal', type: 'select', options: ['breakfast', 'lunch', 'dinner'] },
      { key: 'dish', label: 'Dish', type: 'text', required: true },
    ],
  },
  {
    key: 'documents', label: 'Documents & renewals', group: 'Home', icon: '📁',
    description: 'Passports, licences, insurance — and when they expire.',
    tags: ['home', 'admin', 'documents'], pairs_with: null,
    schema: [
      { key: 'name', label: 'Document', type: 'text', required: true },
      { key: 'reference', label: 'Reference / number', type: 'text' },
      { key: 'expires', label: 'Expires', type: 'date' },
    ],
  },
  {
    key: 'car', label: 'Car & vehicle', group: 'Home', icon: '🚗',
    description: 'Service history, MOT, insurance and fuel.',
    tags: ['home', 'admin', 'car'], pairs_with: null,
    schema: [
      { key: 'date', label: 'Date', type: 'date', required: true },
      { key: 'type', label: 'Type', type: 'select', options: ['service', 'mot', 'insurance', 'repair', 'fuel'] },
      { key: 'cost', label: 'Cost', type: 'number' },
      { key: 'notes', label: 'Notes', type: 'text' },
    ],
  },
  {
    key: 'plants', label: 'Plant care', group: 'Home', icon: '🪴',
    description: 'Keep your plants alive — watering and feeding.',
    tags: ['home', 'plants', 'hobby'], pairs_with: null,
    schema: [
      { key: 'plant', label: 'Plant', type: 'text', required: true },
      { key: 'last_watered', label: 'Last watered', type: 'date' },
      { key: 'every_days', label: 'Water every (days)', type: 'number' },
      { key: 'notes', label: 'Notes', type: 'text' },
    ],
  },

  // ---------------- Hobbies & Passions ----------------
  {
    key: 'travel_bucket', label: 'Travel bucket list', group: 'Passions', icon: '🌍',
    description: 'Places you dream of going.',
    tags: ['passions', 'travel', 'bucket-list'], pairs_with: null,
    schema: [
      { key: 'place', label: 'Place', type: 'text', required: true },
      { key: 'why', label: 'Why', type: 'text' },
      { key: 'when', label: 'Ideal time', type: 'text' },
      { key: 'been', label: 'Been there', type: 'bool' },
    ],
  },
  {
    key: 'trips', label: 'Trips & itineraries', group: 'Passions', icon: '✈️',
    description: 'Plan and remember your trips.',
    tags: ['passions', 'travel', 'planning'], pairs_with: 'Google Calendar',
    schema: [
      { key: 'destination', label: 'Destination', type: 'text', required: true },
      { key: 'start', label: 'Start', type: 'date' },
      { key: 'end', label: 'End', type: 'date' },
      { key: 'notes', label: 'Plans / notes', type: 'text' },
    ],
  },
  {
    key: 'recipes', label: 'Recipes I cooked', group: 'Passions', icon: '👨‍🍳',
    description: 'Build your own cookbook of hits and misses.',
    tags: ['passions', 'cooking', 'food'], pairs_with: null,
    schema: [
      { key: 'dish', label: 'Dish', type: 'text', required: true },
      { key: 'rating', label: 'Rating (1-5)', type: 'number' },
      { key: 'again', label: 'Make again', type: 'bool' },
      { key: 'notes', label: 'Tweaks / notes', type: 'text' },
    ],
  },
  {
    key: 'music_practice', label: 'Music practice', group: 'Passions', icon: '🎸',
    description: 'Track instrument practice and what you worked on.',
    tags: ['passions', 'music', 'practice', 'skills'], pairs_with: null,
    schema: [
      { key: 'date', label: 'Date', type: 'date', required: true },
      { key: 'minutes', label: 'Minutes', type: 'number' },
      { key: 'worked_on', label: 'Worked on', type: 'text' },
    ],
  },
  {
    key: 'watchlist', label: 'Movies & shows', group: 'Passions', icon: '🎬',
    description: 'What to watch and what you thought of it.',
    tags: ['passions', 'film', 'tv', 'entertainment'], pairs_with: null,
    schema: [
      { key: 'title', label: 'Title', type: 'text', required: true },
      { key: 'type', label: 'Type', type: 'select', options: ['film', 'series', 'documentary'] },
      { key: 'status', label: 'Status', type: 'select', options: ['to-watch', 'watching', 'watched'] },
      { key: 'rating', label: 'Rating (1-5)', type: 'number' },
    ],
  },
  {
    key: 'gaming_backlog', label: 'Gaming backlog', group: 'Passions', icon: '🎮',
    description: 'Games to play, playing, and finished.',
    tags: ['passions', 'gaming', 'entertainment'], pairs_with: null,
    schema: [
      { key: 'title', label: 'Game', type: 'text', required: true },
      { key: 'platform', label: 'Platform', type: 'text' },
      { key: 'status', label: 'Status', type: 'select', options: ['backlog', 'playing', 'finished', 'dropped'] },
      { key: 'rating', label: 'Rating (1-5)', type: 'number' },
    ],
  },
  {
    key: 'climbing', label: 'Climbing & sport sessions', group: 'Passions', icon: '🧗',
    description: 'Log sport sessions and grades/progress.',
    tags: ['passions', 'sport', 'fitness', 'climbing'], pairs_with: null,
    schema: [
      { key: 'date', label: 'Date', type: 'date', required: true },
      { key: 'sport', label: 'Sport', type: 'text' },
      { key: 'highlight', label: 'Highlight / grade', type: 'text' },
      { key: 'felt', label: 'How it felt', type: 'text' },
    ],
  },
  {
    key: 'collection', label: 'Collection tracker', group: 'Passions', icon: '🗃️',
    description: 'Whatever you collect — records, sneakers, cards, wine.',
    tags: ['passions', 'collecting', 'hobby'], pairs_with: null,
    schema: [
      { key: 'item', label: 'Item', type: 'text', required: true },
      { key: 'category', label: 'Category', type: 'text' },
      { key: 'acquired', label: 'Acquired', type: 'date' },
      { key: 'value', label: 'Value', type: 'number' },
      { key: 'have_it', label: 'Owned', type: 'bool' },
    ],
  },
];

export default MODULE_TEMPLATES;
