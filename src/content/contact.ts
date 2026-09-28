// Owner-supplied contact details (REVAMP-HANDOFF.md §6; WhatsApp added by Dean on 2026-09-27).
// Email is stored in parts and only joined when a visitor interacts, so the full address never
// appears in the static HTML that simple scrapers read. WhatsApp is a username: no phone number.
export const contact = {
  name: 'Dean',
  studio: 'Dean Studio',
  email: { user: 'mr.hasnuddinn', domain: 'gmail.com' },
  linkedin: { label: 'in/hasnuddin', url: 'https://www.linkedin.com/in/hasnuddin/' },
  whatsapp: { username: '0xDeann' },
} as const;

export const emailAddress = () => `${contact.email.user}@${contact.email.domain}`;
export const mailtoHref = () => `mailto:${emailAddress()}`;
export const whatsappHref = () => `https://wa.me/${contact.whatsapp.username}`;

/** "mr.hasn…@gmail.com": keeps the domain readable, shortens the name part. */
export const emailDisplay = (keep = 7) =>
  `${contact.email.user.slice(0, keep)}…@${contact.email.domain}`;

/** "@0xDeann" */
export const whatsappDisplay = () => `@${contact.whatsapp.username}`;
