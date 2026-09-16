import { PeopleView } from "../people.js";

export function PlatformInvitationsView() {
  return <PeopleView scope={{ platform: true }} initialFilter="pending" />;
}