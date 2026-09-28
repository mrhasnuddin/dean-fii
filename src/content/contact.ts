// Owner-supplied contact details (REVAMP-HANDOFF.md §6; WhatsApp added by Dean on 2026-09-27).
// Email and phone are stored in parts and only joined when a visitor interacts, so the full values
// never appear in the static HTML that simple scrapers read.
export const contact = {
  name: 'Dean',
  studio: 'Dean Studio',
  email: { user: 'mr.hasnuddinn', domain: 'gmail.com' },
  linkedin: { label: 'in/hasnuddin', url: 'https://www.linkedin.com/in/hasnuddin/' },
  whatsapp: { country: '60', parts: ['12', '681', '3743'] },
} as const;

export const emailAddress = () => `${contact.email.user}@${contact.email.domain}`;
export const mailtoHref = () => `mailto:${emailAddress()}`;
export const whatsappHref = () => `https://wa.me/${contact.whatsapp.country}${contact.whatsapp.parts.join('')}`;

/** "mr.hasn…@gmail.com": keeps the domain readable, shortens the name part. */
export const emailDisplay = (keep = 7) =>
  `${contact.email.user.slice(0, keep)}…@${contact.email.domain}`;

/** "+60 12-*** 3743": shows the front and back, masks the middle. */
export const phoneDisplay = () => {
  const [a, b, c] = contact.whatsapp.parts;
  return `+${contact.whatsapp.country} ${a}-${'*'.repeat(b.length)} ${c}`;
};
