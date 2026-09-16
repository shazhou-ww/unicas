import { PeopleView } from "../people.js";

export function PlatformPrincipalsView() {
  return <PeopleView scope={{ platform: true }} />;
}