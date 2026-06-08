import { GeneralClient } from "./general-client";

// No general preferences model in DB — page renders client form with honest stub save.
export default function GeneralPage() {
  return <GeneralClient />;
}
