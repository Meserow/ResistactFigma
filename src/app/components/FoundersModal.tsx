import { useState, type ReactNode } from "react";
import { X, Linkedin, Globe, ExternalLink } from "lucide-react";
import logoImg from "../../assets/6f09d83b1b948a5a0a2a9e7558c073db252c1f59.png";

interface FoundersModalProps {
  onClose: () => void;
}

interface FounderLink {
  label: string;
  href: string;
  icon: "linkedin" | "globe";
}

interface Founder {
  /** Monogram shown in the avatar circle (fallback when no photo). */
  initials: string;
  name: string;
  title: string;
  /** Background color for the monogram circle. */
  color: string;
  /** Optional headshot path (served from /public). Falls back to the monogram
   *  if absent or it fails to load. */
  photo?: string;
  /** Bio split into paragraphs; may contain inline links. */
  paragraphs: ReactNode[];
  links: FounderLink[];
}

/** Round avatar: shows the headshot when available, otherwise the monogram. */
function Avatar({ founder }: { founder: Founder }) {
  const [failed, setFailed] = useState(false);
  if (founder.photo && !failed) {
    return (
      <img
        src={founder.photo}
        alt={founder.name}
        onError={() => setFailed(true)}
        className="w-14 h-14 rounded-full object-cover"
      />
    );
  }
  return (
    <div
      className="w-14 h-14 rounded-full flex items-center justify-center font-['Poppins',sans-serif] font-bold text-white text-[18px] tracking-wide"
      style={{ backgroundColor: founder.color }}
    >
      {founder.initials}
    </div>
  );
}

// Shared styling for links woven into the bio prose.
const inlineLinkClass =
  "font-semibold text-[#23297e] underline decoration-[#ed6624]/40 underline-offset-2 transition-colors hover:text-[#ed6624] hover:decoration-[#ed6624]";

function InlineLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={inlineLinkClass}>
      {children}
    </a>
  );
}

// Bios are authored copy, kept in code so they ship with the build. Edit here
// to update. Patrick's bio is published with his approval.
const FOUNDERS: Founder[] = [
  {
    initials: "EM",
    name: "Ellen Meserow",
    title: "Founder · CEO & UI/UX Designer, Meserow Design Inc.",
    color: "#23297e",
    photo: "/founders/ellen.jpeg",
    paragraphs: [
      "Ellen Meserow has the unusual distinction of having witnessed multiple defining moments in modern Democratic politics from just a few feet away. She got her start in politics right out of college on Bill Clinton's 1992 campaign at the Democratic National Convention, where she saved Al Gore's convention speech with a single press of a button.",
      <>
        She later ran technical operations for{" "}
        <InlineLink href="https://p2004.org/dean/deanorgwa.html">
          Howard Dean's Washington State presidential campaign
        </InlineLink>{" "}
        in 2003 and was in the room for the infamous Iowa “Dean Scream” that ended the campaign. In
        2004, she served on the Credentials Committee at the{" "}
        <InlineLink href="https://www.seattlepi.com/national/article/welcome-to-the-democratic-collection-1150534.php">
          Democratic National Convention
        </InlineLink>
        , where she watched Barack Obama deliver his breakout convention speech from the floor.
      </>,
      "Today, she is the CEO and UI/UX designer of Meserow Design Inc., a Seattle software development firm focused on complex government, sustainability, and financial systems — and the founder of ResistAct.",
    ],
    links: [
      { label: "LinkedIn", href: "https://www.linkedin.com/in/ellen-escarcega-8028192/", icon: "linkedin" },
      { label: "Meserow Design", href: "https://meserow.com/", icon: "globe" },
    ],
  },
  {
    initials: "PE",
    name: "Patrick Escarcega",
    title: "CTO & Managing Partner, Meserow Design Inc.",
    color: "#ed6624",
    photo: "/founders/patrick.jpeg",
    paragraphs: [
      "Patrick Escarcega is a progressive technology leader, feminist ally, and the CTO and Managing Partner of Meserow Design Inc. in Seattle, Washington. With Native American roots in Montana, he spent decades architecting sophisticated financial systems that supported the management of billions of dollars in investments for major institutions and ultra-high-net-worth clients.",
      "Today, he focuses on public-sector and government technology work intended to serve the broader public good. His work combines deep technical expertise with a strong commitment to equity, inclusion, and responsible leadership.",
      "He is also Ellen Meserow's favorite husband.",
    ],
    links: [
      { label: "LinkedIn", href: "https://www.linkedin.com/in/patrickje/", icon: "linkedin" },
      { label: "Meserow Design", href: "https://meserow.com/about-us/", icon: "globe" },
    ],
  },
];

export function FoundersModal({ onClose }: FoundersModalProps) {
  return (
    <div
      className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative bg-white rounded-2xl shadow-2xl w-full max-w-[760px] max-h-[90vh] overflow-y-auto"
      >
        {/* Close */}
        <button
          onClick={onClose}
          className="absolute top-3 right-3 z-10 w-8 h-8 flex items-center justify-center rounded-full bg-black/10 hover:bg-black/20 text-[#23297e] transition-colors"
        >
          <X size={15} />
        </button>

        <div className="p-7">
          {/* Header */}
          <div className="flex items-center gap-3 mb-2">
            <img src={logoImg} alt="ResistAct fist logo" className="w-10 h-10 object-contain shrink-0" />
            <h2 className="font-['Poppins',sans-serif] font-bold text-[#23297e] text-[20px] leading-tight">
              The humans behind ResistAct
            </h2>
          </div>
          <p className="font-['Poppins',sans-serif] text-gray-600 text-[13px] leading-relaxed mb-6">
            ResistAct is built by the team at Meserow Design Inc., a Seattle software firm that
            spends its days on complex government, sustainability, and financial systems — and its
            nights on this.
          </p>

          <div className="space-y-7">
            {FOUNDERS.map((f) => (
              <div key={f.name} className="flex flex-col sm:flex-row gap-4">
                {/* Headshot (falls back to monogram) */}
                <div className="shrink-0">
                  <Avatar founder={f} />
                </div>

                {/* Text column */}
                <div className="flex-1 min-w-0">
                  <h3 className="font-['Poppins',sans-serif] font-bold text-[#23297e] text-[16px] leading-tight">
                    {f.name}
                  </h3>
                  <p className="font-['Poppins',sans-serif] font-semibold text-[#ed6624] text-[12px] leading-snug mt-1.5 mb-2.5">
                    {f.title}
                  </p>

                  <div className="space-y-2">
                    {f.paragraphs.map((p, i) => (
                      <p
                        key={i}
                        className="font-['Poppins',sans-serif] text-gray-600 text-[12.5px] leading-relaxed"
                      >
                        {p}
                      </p>
                    ))}
                  </div>

                  {/* Links */}
                  {f.links.length > 0 && (
                    <div className="flex flex-wrap items-center gap-3 mt-3">
                      {f.links.map((link) => (
                        <a
                          key={link.href}
                          href={link.href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-gray-50 px-3 py-1.5 font-['Poppins',sans-serif] text-[12px] font-semibold text-[#23297e] transition-colors hover:border-[#ed6624] hover:text-[#ed6624]"
                        >
                          {link.icon === "linkedin" ? <Linkedin size={13} /> : <Globe size={13} />}
                          {link.label}
                          <ExternalLink size={11} className="opacity-50" />
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
