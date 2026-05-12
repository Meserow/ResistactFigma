// Shared section data for the vulnerable-group picker. Used by both the
// MatchMe wizard (which asks the user about themselves) and Add-an-Action
// (which asks the action planner whose voice this action especially amplifies).
import type { VulnerableGroup } from "./matcher";

export interface GroupSection {
  title: string;
  options: { value: VulnerableGroup; label: string }[];
}

// Labels are written in plural / collective form because the picker asks
// "Do you want to focus on a particular group being targeted?" — the user is
// picking a group to amplify, not declaring personal identity.
export const GROUP_SECTIONS: GroupSection[] = [
  {
    title: "Race, ethnicity, religion",
    options: [
      { value: "black",                label: "Black Americans" },
      { value: "muslim",               label: "Muslim or Arab Americans" },
      { value: "jewish",               label: "Jewish Americans" },
      { value: "asian",                label: "Asian Americans" },
      { value: "indigenous",           label: "Indigenous or Native peoples" },
      { value: "latino",               label: "Latino or Hispanic Americans" },
      { value: "nonChristianMinority", label: "Non-Christian religious minorities (Sikh, Hindu, secular/atheist)" },
    ],
  },
  {
    title: "Demographic",
    options: [
      { value: "woman",     label: "Women" },
      { value: "lgbtq",     label: "LGBTQIA+ / Trans people" },
      { value: "immigrant", label: "Immigrants (documented, undocumented, mixed-status)" },
      { value: "refugee",   label: "Refugees and asylum seekers" },
      { value: "disabled",  label: "Disabled / chronically ill / medically challenged people" },
      { value: "repro",     label: "People seeking or providing reproductive care" },
    ],
  },
  {
    title: "Role, occupation, status",
    options: [
      { value: "student",            label: "Students" },
      { value: "educator",           label: "Educators, teachers, professors" },
      { value: "publicHealthWorker", label: "Public health workers" },
      { value: "scientist",          label: "Scientists and federal researchers" },
      { value: "lawyer",             label: "Lawyers and judges" },
      { value: "whistleblower",      label: "Government whistleblowers" },
      { value: "libraryWorker",      label: "Library workers and librarians" },
      { value: "nonprofitWorker",    label: "Nonprofit / NGO workers" },
      { value: "electionWorker",     label: "Election workers and poll workers" },
      { value: "veteran",            label: "Veterans" },
      { value: "fedWorker",          label: "Federal workers and contractors" },
      { value: "journalist",         label: "Journalists and researchers" },
      { value: "unionWorker",        label: "Union workers and organizers" },
      { value: "farmworker",         label: "Farmworkers" },
    ],
  },
  {
    title: "Economic",
    options: [
      { value: "lowIncome",        label: "Low-income families" },
      { value: "medicaidMedicare", label: "People who rely on Medicaid or Medicare" },
      { value: "obamacare",        label: "People who rely on Obamacare" },
      { value: "ssdi",             label: "People on Social Security or SSDI" },
      { value: "renter",           label: "Renters and housing-insecure people" },
    ],
  },
  {
    title: "Geographic or situational",
    options: [
      { value: "ruralHealthcare",  label: "Rural communities losing healthcare or USDA programs" },
      { value: "climateAffected",  label: "People affected by climate disasters" },
      { value: "abortionTravel",   label: "People in abortion-ban states seeking interstate care" },
      { value: "incarcerated",     label: "Incarcerated people and their families" },
      { value: "unhoused",         label: "Unhoused people" },
    ],
  },
];

export const GROUP_LABELS: Partial<Record<VulnerableGroup, string>> = Object.fromEntries(
  GROUP_SECTIONS.flatMap((s) => s.options.map((o) => [o.value, o.label] as const))
);
