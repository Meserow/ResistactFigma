// Shared section data for the vulnerable-group picker. Used by both the
// MatchMe wizard (which asks the user about themselves) and Add-an-Action
// (which asks the action planner whose voice this action especially amplifies).
import type { VulnerableGroup } from "./matcher";

export interface GroupSection {
  title: string;
  options: { value: VulnerableGroup; label: string }[];
}

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
      { value: "woman",     label: "Woman" },
      { value: "lgbtq",     label: "LGBTQIA+ / Trans" },
      { value: "immigrant", label: "Immigrant (documented, undocumented, mixed-status)" },
      { value: "refugee",   label: "Refugee or asylum seeker" },
      { value: "disabled",  label: "Disabled / chronically ill / medically challenged" },
      { value: "repro",     label: "Seeking or providing reproductive care" },
    ],
  },
  {
    title: "Role, occupation, status",
    options: [
      { value: "student",            label: "Student" },
      { value: "educator",           label: "Educator / teacher / professor" },
      { value: "publicHealthWorker", label: "Public health worker" },
      { value: "scientist",          label: "Scientist or federal researcher" },
      { value: "lawyer",             label: "Lawyer or judge" },
      { value: "whistleblower",      label: "Government whistleblower" },
      { value: "libraryWorker",      label: "Library worker or librarian" },
      { value: "nonprofitWorker",    label: "Nonprofit / NGO worker" },
      { value: "electionWorker",     label: "Election worker or poll worker" },
      { value: "veteran",            label: "Veteran" },
      { value: "fedWorker",          label: "Federal worker / contractor" },
      { value: "journalist",         label: "Journalist / researcher" },
      { value: "unionWorker",        label: "Union worker or organizer" },
      { value: "farmworker",         label: "Farmworker" },
    ],
  },
  {
    title: "Economic",
    options: [
      { value: "lowIncome",        label: "Low-income family" },
      { value: "medicaidMedicare", label: "Relies on Medicaid or Medicare" },
      { value: "obamacare",        label: "Relies on Obamacare" },
      { value: "ssdi",             label: "Receives Social Security or SSDI" },
      { value: "renter",           label: "Renter or housing-insecure" },
    ],
  },
  {
    title: "Geographic or situational",
    options: [
      { value: "ruralHealthcare",  label: "Rural community losing healthcare or USDA programs" },
      { value: "climateAffected",  label: "Affected by climate disasters" },
      { value: "abortionTravel",   label: "In a state with an abortion ban, seeking interstate care" },
      { value: "incarcerated",     label: "Incarcerated or family of an incarcerated person" },
      { value: "unhoused",         label: "Unhoused" },
    ],
  },
];

export const GROUP_LABELS: Partial<Record<VulnerableGroup, string>> = Object.fromEntries(
  GROUP_SECTIONS.flatMap((s) => s.options.map((o) => [o.value, o.label] as const))
);
