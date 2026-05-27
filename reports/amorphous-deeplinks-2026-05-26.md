# Deep-Link Audit — Amorphous Cards
Generated: 2026-05-26  |  Source: SEED_CARDS in supabase/functions/make-server-9eb1ae04/index.ts

## Summary
- **Total audited**: 180 cards with bare-domain targetUrl
- **Proposed deep-link fixes**: 156 cards  (high confidence: 116, medium: 36)
- **Homepage IS the action** (keep as-is): 19 cards
- **Could not resolve**: 5 cards
- **Defunct/dormant orgs**: 6 cards — need removal or replacement
- **Synopsis mis-tags**: 25 cards — synopsis names the wrong org
- **Duplicate pairs flagged**: 4 cards

## All Cards

| ID | Title | Original URL | Proposed URL | Conf | Notes |
|----|-------|-------------|-------------|------|-------|
| 1000 | Search any brand's political donations before you buy | goodsuniteus.com/ | goodsuniteus.com/app/ | medium | Search is app-based, not a website form. /app/ page links to App Store + Google  |
| 1001 | Get the browser extension that flags MAGA-aligned brands | progressiveshopper.com/ | ✓ keep | medium | Homepage is the action — no change needed. Could alternatively deep-link directl |
| 1002 | Use the Trump-tied retailers boycott list | grabyourwallet.org/ | docs.google.com/spreadsheets/d/1vu0Y0HvadMgG_LN7dF8W7M66oPCcx_nmSARQWirV7iY/edit | high | External Google Sheet — if linking off-domain is undesirable, keep homepage and  |
| 1003 | Join coordinated 24-hour economic blackouts | thepeoplesunionusa.com/ | thepeoplesunionusa.com/boycotts | high |  |
| 1004 | Sign the Tesla Takedown commitment | teslatakedown.com/ | ✓ keep | medium | Homepage is the action — no change needed. The /divest page is about city resolu |
| 1005 | Join the Latino-led economic blackout | latinofreeze.com/ | ✓ keep | medium | Homepage is the action — no change needed. |
| 1006 | Switch your spending to a Black-women-owned biz | buyfromablackwoman.org/ | buyfromablackwoman.org/online-directory | high |  |
| 1008 | Buy from a Native-owned business instead | beyondbuckskin.com/ | beyondbuckskin.com/p/buy-native.html | high | URL uses old Blogger path (http, .html) but it is the canonical 'Buy Native List |
| 1009 | RSVP to the next Saturday Tesla Takedown | teslatakedown.com/ | actionnetwork.org/event_campaigns/teslatakedown | high | External actionnetwork.org URL. Could keep teslatakedown.com if cross-domain lin |
| 1011 | Become a Veterans for Peace member | veteransforpeace.org/ | veteransforpeace.org/take-action/join | high |  |
| 1012 | Join About Face: Veterans Against the War | aboutfaceveterans.org/ | aboutfaceveterans.org/become-a-member/ | high |  |
| 1013 | Find an ADAPT chapter (disability direct action) | adapt.org/ | adapt.org/adapt-groups/ | high |  |
| 1014 | Find a Drag Story Hour to attend / livestream | dragstoryhour.org/ | dragstoryhour.org/chaptermap | high |  |
| 1015 | Sign up for Refuse Fascism action alerts | refusefascism.org/ | refusefascism.org/signup/ | high |  |
| 1016 | Sign up with Code Pink | codepink.org/ | codepink.org/get_involved | medium | Could also propose /onboarding (orientation sessions) but get_involved is the br |
| 1018 | Sponsor + drive for refugees via Welcome.US | welcome.us/ | welcome.us/get-involved | high | Note that Welcome Corps was terminated in Feb 2025 — sponsorship intake may be p |
| 1020 | Submit a tip on criminal-justice / detention | themarshallproject.org/ | themarshallproject.org/how-to-contact-us | high | Alternative: /investigate-this is for local journalism partners, not public tips |
| 1021 | Submit a leak to The Intercept | theintercept.com/ | theintercept.com/source/ | high |  |
| 1023 | Pitch a Black-community story | capitalbnews.org/ | capitalbnews.org/contact-us/ | medium | Contact form does not specifically prompt for 'pitch' — but it's the only intake |
| 1024 | Pitch a gender + politics story | 19thnews.org/ | 19thnews.org/contact-us/ | medium | Note: The 19th explicitly states they do not currently accept freelance stories  |
| 1025 | Pitch on local DA / sheriff / election admin | boltsmag.org/ | boltsmag.org/pitch-us/ | high |  |
| 1026 | Send an investigative idea | typeinvestigations.org/ | typeinvestigations.org/about/how-to-pitch/ | high |  |
| 1027 | Pitch a war / civil-liberties story | dropsitenews.com/ | dropsitenews.com/about | medium | Drop Site is a Substack-hosted newsroom with limited site structure; /about is c |
| 1028 | Pitch a labor story (video) | perfectunion.us/ | perfectunion.us/about/ | medium | Site does not have a dedicated tip-submission form — /about is the closest match |
| 1029 | Send a dark-money tip | levernews.com/ | levernews.com/got-a-news-tip/ | high |  |
| 1030 | Submit a campaign-finance tip | readsludge.com/ | readsludge.com/contact/ | high |  |
| 1032 | Find your nearest chapter + meeting time | dsausa.org/ | dsausa.org/chapters/ | high | Alternative: /chapter-map/ for an interactive map view — either is reasonable. |
| 1033 | Apply to a virtual intro call | surj.org/ | act.surj.org/a/member-orientation | high | Subdomain (act.surj.org) — uses Action Network behind the scenes; works as deep  |
| 1034 | Sign up for a hub welcome call | sunrisemovement.org/ | sunrisemovement.org/welcome-call/ | high |  |
| 1035 | RSVP for next event (local + virtual) | workingfamilies.org/ | mobilize.us/workingfamilies/ | medium | External mobilize.us URL. Alternative on-domain option: https://workingfamilies. |
| 1036 | Join virtual monthly mass assembly | poorpeoplescampaign.org/ | ✓ keep | low | Homepage is closest to the action — specific assembly event pages rotate. Consid |
| 1037 | Find your local circle | mijente.net/ | mijente.net/join/ | low | Synopsis field is wrong (says 'Indivisible' — Mijente is a Latinx-led org). Mije |
| 1038 | Find a local team | mothersoutfront.org/ | mothersoutfront.org/local-teams/ | high | Synopsis incorrectly says 'Field Team 6 voter-mobilization squads' — Mothers Out |
| 1039 | Find a local group | bendthearc.us/ | bendthearc.us/act_locally | high | Synopsis says 'MoveOn local action-team finder' — Bend the Arc is a Jewish progr |
| 1041 | Join a federal-worker organizing call | federalunionists.net/ | federalunionists.net/join-us | high | Alternative: /federal-workers if targeting fed workers specifically; /join-us is |
| 1047 | Embroider + ship a Trump quote to the archive | tinypricksproject.com/ | ✓ keep | medium | Homepage is the action — no change needed. |
| 1048 | Knit a Welcome Blanket for a new immigrant | welcomeblanket.org/ | welcomeblanket.org/getinvolved | high | Alternative: /patterns/ for the patterns themselves; /getinvolved is the full in |
| 1049 | Knit a Pussyhat from updated patterns | pussyhatproject.com/ | pussyhatproject.com/knit | high |  |
| 1050 | Sign up for the postcard drop | thepostcardposse.org/ | ⚠️ none | low | Domain may be dead or unindexed — manual check needed. If goal is generic postca |
| 1051 | Mail a handmade card to a detained migrant | freedomforimmigrants.org/ | freedomforimmigrants.org/volunteer | medium | Alternative: https://flowersontheinside.org/ is a dedicated 'send a card to immi |
| 1052 | Sign petitions to overturn Citizens United | movetoamend.org/ | movetoamend.org/motion | high | Alternative: /petition (slightly different framing). Both reach a signature form |
| 1053 | Sign current petitions | citizen.org/ | citizen.org/act/ | high | Synopsis says 'MoveOn petition action queue' — Public Citizen is not MoveOn. Syn |
| 1055 | Sign court-reform petitions | demandjustice.org/ | demandjustice.org/action-center/ | high |  |
| 1056 | Sign media-reform petitions | freepress.net/ | freepress.net/get-involved/sign-petition | high |  |
| 1057 | Sign civil-rights petitions | ccrjustice.org/ | ccrjustice.org/home/get-involved/take-action | medium | Synopsis says 'ACLU national petition queue' — CCR is not ACLU. Synopsis field i |
| 1058 | Sign Black-led racial-justice petitions | colorofchange.org/ | colorofchange.org/issues/ | high |  |
| 1059 | Sign civil-liberties petitions | demandprogress.org/ | demandprogress.org/get-involved/ | high | Synopsis says 'EFF digital-rights petition queue' but the URL is demandprogress. |
| 1061 | Sign Christian-rooted petitions vs. Christian nationalism | faithfulamerica.org/ | faithfulamerica.org/campaigns/resist-christian-nationalism | high |  |
| 1062 | Sign anti-militarism petitions | winwithoutwar.org/ | winwithoutwar.org/take-action/ | high |  |
| 1063 | Sign petitions to close ICE facilities | detentionwatchnetwork.org/ | detentionwatchnetwork.org/take-action/campaigns | high |  |
| 1064 | Sign the open letter against book bans | authorsagainstbookbans.com/ | ⚠️ none | low | Membership/sign-on appears to be author/illustrator/publishing-professional only |
| 1067 | Sign children's-rights petitions | childrensdefense.org/ | childrensdefense.org/get-involved/take-action/ | high |  |
| 1068 | Become a SURJ member | surj.org/ | surj.org/join/ | high |  |
| 1069 | Become a DSA member | dsausa.org/ | act.dsausa.org/donate/membership/ | high |  |
| 1070 | Join Sunrise Movement | sunrisemovement.org/ | sunrisemovement.org/join/ | high |  |
| 1071 | Join Mijente | mijente.net/ | mijente.net/join/ | high | Membership is open to Latinx/Chicanx people; allies can sign the listserv separa |
| 1072 | Join United We Dream | unitedwedream.org/ | unitedwedream.org/join-united-we-dream/ | high |  |
| 1073 | Join Bend the Arc | bendthearc.us/ | ✓ keep | low | No single national join/membership page found. Local chapter signups are city-sp |
| 1074 | Join Jewish Voice for Peace | jewishvoiceforpeace.org/ | jewishvoiceforpeace.org/join-us/ | high |  |
| 1075 | Join T'ruah (rabbinic human rights) | truah.org/ | truah.org/actions/ | medium | Formal membership (Chaverim network) is restricted to rabbis and cantors. For th |
| 1076 | Subscribe to FCNL action alerts (Quaker) | fcnl.org/ | act.fcnl.org/signup/signup-action-alerts | high |  |
| 1077 | Join Pax Christi USA (Catholic peace) | paxchristiusa.org/ | paxchristiusa.org/join/ | high |  |
| 1078 | Take a NETWORK action (Catholic social justice) | networklobby.org/ | networklobby.org/take-action/ | medium | URL inferred from site nav pattern — not confirmed by explicit search snippet, b |
| 1080 | Take a Sikh Coalition action | sikhcoalition.org/ | sikhcoalition.org/get-involved/take-action/ | high |  |
| 1084 | Volunteer with Mothers Out Front | mothersoutfront.org/ | mothersoutfront.org/get-involved/ | high |  |
| 1085 | Take an ADAPT action (disability rights) | adapt.org/ | adapt.org/getting-involved/ | high |  |
| 1086 | Take a Black Voters Matter action | blackvotersmatterfund.org/ | blackvotersmatterfund.org/action-hub/ | high |  |
| 1087 | Take a Mi Familia Vota action | mifamiliavota.org/ | mifamiliavota.org/volunteer | high |  |
| 1088 | Take a Climate Justice Alliance action | climatejusticealliance.org/ | climatejusticealliance.org/workgroup/our-power/ | medium | CJA is primarily a coalition of organizations, not a direct individual action pl |
| 1091 | Sponsor a refugee household | welcome.us/ | welcome.us/become-a-sponsor/intro-to-sponsorship | high | IMPORTANT: The Welcome Corps (federal private sponsorship program) was terminate |
| 1092 | Make your city 'welcoming' for immigrants | welcomingamerica.org/ | welcomingamerica.org/the-welcoming-standard/ | high | Welcoming Network membership is for local governments and nonprofits, not indivi |
| 1093 | Pressure your mayor on sanctuary policy | citiesforaction.us/ | citiesforaction.us/actions | medium | Cities for Action is a mayors' coalition — it's aimed at elected officials, not  |
| 1094 | Volunteer to furnish + resettle refugee homes | homesnotborders.org/ | homesnotborders.org/volunteer/ | high | Homes Not Borders operates in the DC Metro Area — geographically limited. |
| 1095 | Get an organizer for your workplace | workerorganizing.org/ | workerorganizing.org/lets-organize-your-workplace-3276/ | medium | The numeric slug suggests this may be a campaign-specific post URL and could cha |
| 1096 | Join the federal-worker network | federalunionists.net/ | federalunionists.net/join-us | high |  |
| 1097 | Subscribe to independent labor media | labornotes.org/ | labornotes.org/email-signup | high |  |
| 1098 | Start a workplace petition | home.coworker.org/ | home.coworker.org/campaign-support/ | high |  |
| 1099 | Take a UE solidarity action | ueunion.org/ | ueunion.org/campaigns/international-solidarity | high |  |
| 1100 | Apply for IWW membership | iww.org/ | redcard.iww.org/ | high |  |
| 1101 | Sign on to a National Domestic Workers Alliance campaign | domesticworkers.org/ | domesticworkers.org/programs-and-campaigns/developing-policy-solutions/take-action/ | high |  |
| 1102 | Send solidarity to Starbucks Workers United | sbworkersunited.org/ | sbworkersunited.org/take-action/ | high |  |
| 1103 | Take an Amazon Labor Union action | amazonlaborunion.org/ | amazonlaborunion.org/solidarity-membership | medium | Multiple action entry points exist: /safety-petition, /immigrant-solidarity, /so |
| 1104 | Use the free legal hotline (workplace family rights) | abetterbalance.org/ | abetterbalance.org/get-help/ | high |  |
| 1105 | Sign on to a Fight For A Union worker campaign | fightforaunion.org/ | action.fightforaunion.org/a/unions-for-all | medium | Multiple active campaigns on action.fightforaunion.org — unions-for-all chosen a |
| 1106 | Sign the moral covenant | breachrepairers.org/ | breachrepairers.org/moral-agenda | medium | No single 'sign the covenant' form URL confirmed — the moral agenda page and Mor |
| 1107 | Subscribe to action alerts | sojo.net/ | act.sojo.net/page/74900/subscribe/1?locale=en-US | high |  |
| 1108 | Subscribe to actions | faithfulamerica.org/ | faithfulamerica.org/campaigns/resist-christian-nationalism | high | Synopsis is mis-tagged: says 'Bread for the World hunger-advocacy alerts' but UR |
| 1109 | Sign on to a Faith in Public Life advocacy action | faithinpubliclife.org/ | faithinpubliclife.org/programs/ | medium | No standalone /take-action/ or /campaigns/ page confirmed in search results. FPL |
| 1110 | Take a rabbinic action | truah.org/ | truah.org/actions/ | high | This card duplicates card 1075 (same URL). Cards 1075 and 1110 both point to tru |
| 1111 | Sign on to a Pax Christi USA peace action | paxchristiusa.org/ | paxchristiusa.org/backfromthebrink/ | medium | This card duplicates card 1077 (same URL, same org). Cards 1077 and 1111 both po |
| 1112 | Subscribe to Quaker action alerts | fcnl.org/ | act.fcnl.org/signup/signup-action-alerts | high | Synopsis says 'American Friends Service Committee alerts' but FCNL (Friends Comm |
| 1113 | Sign on to an Auburn Seminary faith-leader campaign | auburnseminary.org/ | action.groundswell-mvmt.org/ | medium | Groundswell is a project of Auburn Seminary, so this is the correct action desti |
| 1115 | Sign on to a Hindus for Human Rights action | hindusforhumanrights.org/ | hindusforhumanrights.org/newsletter-register | low | Site has an events-list page (/events-list) and periodic petition campaigns but  |
| 1116 | Sign on to a Sikh Coalition civil-rights action | sikhcoalition.org/ | sikhcoalition.org/get-involved/take-action/ | high |  |
| 1117 | Sign up as a volunteer attorney | wetheaction.org/ | wetheaction.org/join_us | high | Synopsis says 'ImmDef pro bono attorney signup' but We The Action is a separate  |
| 1118 | Volunteer as an attorney | lawyersforgoodgovernment.org/ | lawyersforgoodgovernment.org/volunteer | high | Synopsis says 'Lawyers' Committee for Civil Rights cases' but this org is Lawyer |
| 1119 | Find pro bono cases (formerly Pro Bono Net) | scalejustice.org/ | scalejustice.org/get-involved | high |  |
| 1120 | Volunteer your tech skills | codeforamerica.org/ | ⚠️ none | high | Site may be effectively dormant for volunteer purposes. The Brigade Network page |
| 1121 | Sign up as a tech volunteer | democracylab.org/ | democracylab.org/projects | high | Synopsis says 'U.S. Digital Response rapid-deploy techies' but DemocracyLab is a |
| 1122 | Volunteer your professional skills | catchafire.org/ | catchafire.org/volunteers | high |  |
| 1123 | Volunteer as a translator | respondcrisistranslation.org/ | respondcrisistranslation.org/en/get-involved | high | Synopsis says 'Translators Without Borders volunteer pool' but Respond Crisis Tr |
| 1124 | Volunteer as a linguist | clearglobal.org/ | clearglobal.org/translators-without-borders/ | medium | Synopsis says 'Respond Crisis Translation rapid pool' but this org is CLEAR Glob |
| 1125 | Sign on to a Doctors for America healthcare campaign | doctorsforamerica.org/ | doctorsforamerica.org/become-member | high |  |
| 1126 | Train as asylum-evaluation clinician | phr.org/ | phr.org/get-involved/participate/health-professionals/ | high |  |
| 1127 | Sign up to run for office (STEM) | 314action.org/ | 314action.org/run-for-office/ | high |  |
| 1128 | Volunteer with Authors Against Book Bans | authorsagainstbookbans.com/ | ⚠️ none | medium | Homepage is the effective entry point; membership/volunteer onboarding is done v |
| 1129 | Join Concerned Archivists Alliance | concernedarchivists.wordpress.com/ | concernedarchivists.wordpress.com/contact/ | medium | WordPress-based site; the organization relaunched in March 2025 ('The Return of  |
| 1130 | Volunteer on detained-immigrant cases | immigrationjustice.us/ | immigrationjustice.us/volunteer-application-form/ | high | Synopsis says 'ImmDef detained-immigrant defense cases' but this org is the Immi |
| 1131 | Take the anti-coup civil-resistance pledge | choosedemocracy.us/ | choosedemocracy.us/pledge/ | high |  |
| 1135 | Carry KYR cards for ICE encounters | immigrantdefenseproject.org/ | immigrantdefenseproject.org/know-your-rights-with-ice/ | high | Synopsis says 'Know-Your-Rights wallet cards from ILRC' but this org is the Immi |
| 1141 | Send email-your-rep | citizen.org/ | citizen.org/act/ | high | Synopsis says 'Common Cause prefilled email tool' but this org is Public Citizen |
| 1142 | Send anti-militarism email | winwithoutwar.org/ | winwithoutwar.org/take-action/ | high |  |
| 1143 | Send Christian-rooted email-your-rep | faithfulamerica.org/ | act.faithfulamerica.org/ | high |  |
| 1144 | Send Quaker constituent email | fcnl.org/ | fcnl.org/act | high |  |
| 1145 | Email targeting specific ICE facilities | detentionwatchnetwork.org/ | detentionwatchnetwork.org/take-action | high |  |
| 1146 | Email your school board re: book bans | authorsagainstbookbans.com/ | ✓ keep | low | Homepage is the action entry point. The card's synopsis field is null — that's f |
| 1147 | Sign up for a workshop | trainingforchange.org/ | trainingforchange.org/public-workshops/ | high | Synopsis says 'Beautiful Trouble action-design workshops' but this org is Traini |
| 1148 | Sign up for a training | ruckus.org/ | ruckus.org/trainings/ | high | Synopsis says 'Wellstone Action progressive-organizing training' but this org is |
| 1149 | Apply to a cohort | wildfireproject.org/ | wildfireproject.org/wildfire-fellowship/ | medium | Synopsis says 'Movement School organizer training program' which is a different  |
| 1150 | Take a course | peopleshub.org/ | peopleshub.org/individuals | high | Synopsis says 'AROC Arab-organizing political education' but PeoplesHub is a dif |
| 1151 | Enroll in a free training | righttobe.org/ | righttobe.org/upcoming-free-trainings/ | high | Synopsis says 'Momentum mass-movement training' but this org is Right To Be (for |
| 1152 | Enroll in anti-coup training | choosedemocracy.us/ | choosedemocracy.us/trainings/ | high |  |
| 1153 | Enroll in programs | beta.highlandercenter.org/ | beta.highlandercenter.org/the-school/ | medium | Site still uses 'beta.' subdomain; the canonical domain may be highlandercenter. |
| 1154 | Sign up for a curriculum | movementgeneration.org/ | movementgeneration.org/category/resources/curriculum/ | medium | Synopsis says 'Resource Generation wealthy-redistribution program' but Movement  |
| 1155 | Take an abolitionist study course | project-nia.org/ | ⚠️ none | high | Site may be dormant/archived. Project NIA sunsetted December 2023. This card sho |
| 1156 | Sign up for a reading group | criticalresistance.org/ | criticalresistance.org/abolitionist-educators-workgroup/ | low | Synopsis says 'Showing Up for Racial Justice reading group' but this org is Crit |
| 1157 | Apply to be a paid poll worker | powerthepolls.org/ | ✓ keep | high | Homepage is the action. The /dosomething and /protectdemocracy pages also exist  |
| 1158 | Take a Know Your Rights training | immigrantdefenseproject.org/ | immigrantdefenseproject.org/community-education-workshops-and-trainings/ | high | Synopsis says 'ACLU KYR online training session' but this org is the Immigrant D |
| 1160 | Sign up for kindness-toned voter postcards | postcardstovoters.org/ | postcardstovoters.org/volunteer/ | high | Synopsis says 'Vote Forward warm voter-turnout letters' but this org is Postcard |
| 1161 | Become a pen pal to a detained migrant | freedomforimmigrants.org/ | freedomforimmigrants.org/volunteer | high |  |
| 1162 | Volunteer (LGBTQ youth digital crisis support) | thetrevorproject.org/ | thetrevorproject.org/volunteer/ | high | The volunteer application for Crisis Counselors is currently unavailable (closed |
| 1164 | Practice rest-as-resistance prompts | thenapministry.wordpress.com/ | thenapministry.wordpress.com/2020/01/17/resources-for-the-rest-resistance-this-is-about-more-than-naps/ | medium | The Nap Ministry's main online presence has moved to Instagram and other platfor |
| 1165 | Find + amplify your local mutual aid | mutualaidhub.org/ | ✓ keep | high | Homepage is the action. |
| 1167 | Subscribe + share Capital B (Black-led) | capitalbnews.org/ | capitalbnews.org/newsletters/ | high |  |
| 1168 | Subscribe + share The 19th* (gender + politics) | 19thnews.org/ | 19thnews.org/newsletters/daily/ | high |  |
| 1169 | Subscribe + share Documented (NYC immigration) | documentedny.com/ | documentedny.com/newsletter/ | high |  |
| 1171 | Subscribe + share The Lever | levernews.com/ | levernews.com/subscribe/ | high |  |
| 1172 | Submit + share a press-freedom incident | pressfreedomtracker.us/ | pressfreedomtracker.us/contact/ | medium | A /all-incidents/ page exists for browsing the database. The submit/report path  |
| 1174 | Download free protest art | amplifier.org/ | amplifier.org/free-downloads/ | high |  |
| 1175 | Download free anti-fascist posters | justseeds.org/ | justseeds.org/graphics/ | high |  |
| 1176 | Download educational graphics | beehivecollective.org/ | beehivecollective.org/graphics-projects/use-our-graphics/ | high |  |
| 1177 | Submit an embroidery piece | tinypricksproject.com/ | tinypricksproject.com/participate/ | high |  |
| 1178 | Apply to programs | tonyc.nyc/ | tonyc.nyc/public_workshops | high |  |
| 1179 | Use the tactical-prank toolkit | theyesmen.org/ | theyesmen.org/learn/bookoftricks | high |  |
| 1180 | Refer an artist at risk | artistsatriskconnection.org/ | artistsatriskconnection.org/i-am-at-risk/ | medium | Card says 'refer an artist at risk' implying third-party submission; site primar |
| 1181 | Find your local mutual aid network | mutualaidhub.org/ | ✓ keep | medium | homepage is the action — the mutual aid map/directory appears to be embedded on  |
| 1186 | Volunteer as a translator for asylum seekers | respondcrisistranslation.org/ | respondcrisistranslation.org/en/get-involved | high |  |
| 1192 | Boost Sludge's dark-money & GOP-donor reporting | readsludge.com/ | readsludge.com/membership/ | high |  |
| 1193 | Boost Bolts Magazine's local-democracy reporting | boltsmag.org/ | boltsmag.org/newsletter/ | high |  |
| 1194 | Boost Drop Site News on Trump's wars & civil liberties | dropsitenews.com/ | dropsitenews.com/subscribe | high | Drop Site News is Substack-hosted; /subscribe is the Substack subscription endpo |
| 1196 | Boost More Perfect Union's worker-power journalism | perfectunion.us/ | substack.perfectunion.us/ | medium | homepage is the action for video content; Substack homepage at substack.perfectu |
| 1202 | Boost Inkstick's anti-war foreign-policy reporting | inkstickmedia.com/ | inkstickmedia.com/newsletters/ | high |  |
| 1203 | Read + share data | inequality.org/ | inequality.org/facts/ | medium | Card says 'read + share wealth-concentration data' — /facts/ is the chart librar |
| 1204 | Sign up for op-ed training | theopedproject.org/ | theopedproject.org/workshops | high |  |
| 1205 | Use weekly LTE prompts (formerly Sister District) | stateswin.org/ | stateswin.org/take-action/ | medium | stateswin.org rebranded from Sister District; no LTE-specific tool page surfaced |
| 1206 | Use the Two-Minute Activist tool | aauw.org/ | aauw.org/act/two-minute-activist/ | high |  |
| 1207 | Use the LTE writer tool | sierraclub.org/ | sierraclub.org/write-your-letter-editor | high |  |
| 1208 | Use LTE templates with verified statistics | inequality.org/ | inequality.org/action/ | medium | No dedicated LTE-template-only page surfaced; /action/ is the action hub. For th |
| 1215 | Call peer crisis line: 877-565-8860 | translifeline.org/ | ✓ keep | high | homepage is the action — hotline number is the CTA, not a web form. |
| 1216 | Reach via 24/7 chat / text / phone | thetrevorproject.org/ | thetrevorproject.org/get-help/ | high |  |
| 1217 | Call peer hotline / chat | lgbthotline.org/ | lgbthotline.org/chat/ | high | For phone-only users: lgbthotline.org/national-hotline/ is also a valid deep lin |
| 1218 | Text HOME to 741741 | crisistextline.org/ | ✓ keep | high | homepage is the action — text 741741 is the CTA. |
| 1220 | Find a peer mental-health chapter | activeminds.org/ | activeminds.org/programs/chapters/ | high |  |
| 1221 | Find a free virtual support group | nami.org/ | nami.org/support-groups/ | high |  |
| 1223 | Sign up to run for office (under 40, progressive) | runforsomething.net/ | runforsomething.net/run/ | high |  |
| 1224 | Apply to candidate training (women) | voterunlead.org/ | ✓ keep | low | No dedicated application or training sub-page indexed. Homepage may have a top-l |
| 1225 | Apply to candidate training (Dem women) | emergeamerica.org/ | emergeamerica.org/candidate-training/ | high |  |
| 1226 | Apply to candidate training (Black women) | higherheightsforamerica.org/ | ✓ keep | low | No candidate training application page found in search results. Site may have li |
| 1233 | Find DOJ-accredited rep training | cliniclegal.org/ | cliniclegal.org/training/accreditation | high |  |
| 1251 | Sell your Tesla | teslatakedown.com | teslatakedown.com/story | medium | homepage is also effectively the action — the site's entire CTA is 'sell your Te |
| 1252 | Dump your TSLA stock | teslatakedown.com | teslatakedown.com/divest | medium | The /divest page is oriented toward institutional divestment (city resolutions,  |
| 1253 | Find a Tesla Takedown protest near you | teslatakedown.com | actionnetwork.org/event_campaigns/teslatakedown | high | Deep link is on a third-party platform (Action Network), not teslatakedown.com i |
| 1254 | Plan a Tesla Takedown protest in your city | teslatakedown.com | teslatakedown.com/ | low | homepage is the action — host toolkit may be embedded on homepage or linked from |
| 1270 | 50501 Joplin / Citizens Against Tyranny — monthly meeting | events.pol-rev.com/ | ✓ keep | low | This is a time-specific local meeting card (May 16). The event URL would be a UU |
| 1271 | BloNo IL community meeting & cookout (Central IL Iron Front) | events.pol-rev.com/ | ✓ keep | low | Time-specific local event card (May 17). Homepage is the platform calendar; the  |
| 1272 | We The People of Ohio — Constitution day in Mentor | events.pol-rev.com/ | ✓ keep | low | Time-specific local event card (May 17). Homepage is best durable URL for the ev |
| 1278 | Subscribe to Blaire Erskine's Substack | blaireerskine.substack.com/ | ✓ keep | high | homepage is the action — Substack homepage is the subscription page. |
| 1360 | Color Your Way Through Trump 2.0 with Fresh Prints' Anti-Trump Resistance Coloring Book | freshprintshandmade.etsy.com | etsy.com/listing/1847181751/anti-trump-adult-coloring-book-pages | medium | Listing 1847181751 is Volume 1 ('Coloring Through Chaos'). Volume 2 is at etsy.c |
| 1383 | Build (and Whack) a Trumpiñata with Carlyn Yandle's Collaborative How-To | carlynyandle.substack.com | ✓ keep | medium | homepage is the action for subscription purposes. The specific piñata post URL w |
| 1401 | Color Your Way Through Resistance With Fresh Prints's Anti-Trump Coloring Book | freshprintshandmade.etsy.com/ | etsy.com/listing/1847181751/anti-trump-adult-coloring-book-pages | medium | Duplicate of card 1360 (same shop/product, different title framing). Both should |