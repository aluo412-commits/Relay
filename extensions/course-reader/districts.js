// Reviewed allow-list. Selecting a district is not proof of school enrollment.
export const DISTRICTS = [
  { id: "fuhsd", short: "FUHSD", name: "Fremont Union High School District", schoology: "https://fuhsd.schoology.com", website: "https://www.fuhsd.org", calendar: "https://www.fuhsd.org/about-us/general-information/calendar", emailDomain: "fuhsd.org" },
  { id: "pausd", short: "PAUSD", name: "Palo Alto Unified School District", schoology: "https://pausd.schoology.com", website: "https://www.pausd.org", calendar: "https://www.pausd.org", emailDomain: "pausd.org" },
];
export function districtById(id) { return DISTRICTS.find(d => d.id === id) || null; }
export function districtByOrigin(origin) { return DISTRICTS.find(d => d.schoology === origin) || null; }
