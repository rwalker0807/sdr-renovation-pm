// Company-wide settings that aren't data. Edit here and push to change the site.

/** Zapier Interfaces forms on the Home page.
 *  embed: true shows the form inside the page. Only turn it on after the Interface allows embedding
 *  (Zapier Interface > Settings > embedding, add rwalker0807.github.io); otherwise browsers block it. */
export const ZAPIER_FORMS = [
  {
    id: 'venture-sdr',
    label: 'Venture / SDR Job Submission',
    description: 'Submit a new Venture or SDR job.',
    url: 'https://new-form-project-fca85d.zapier.app/page',
    embed: false,
  },
  {
    id: 'new-job',
    label: 'New Job Form',
    description: 'General new-job intake form.',
    url: 'https://new-form-project-e87552.zapier.app/',
    embed: false,
  },
];
