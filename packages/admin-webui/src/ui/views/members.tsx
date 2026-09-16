import { PeopleView } from "./people.js";

export function MembersView(props: { appId: string; appRevision: number; onChanged: () => void }) {
  return <PeopleView scope={props} />;
}