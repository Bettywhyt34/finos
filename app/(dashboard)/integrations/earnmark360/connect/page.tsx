import { ConnectWithDiscovery } from "../../_components/connect-with-discovery";

export default function Earnmark360ConnectPage() {
  return (
    <ConnectWithDiscovery
      source="earnmark360"
      productName="EARNMARK360"
      connectPath="/api/integrations/earnmark360/connect"
      defaultUrl="https://earnmark360.com.ng"
      scopes={["Read employee records", "Read payroll runs", "Read attendance data"]}
    />
  );
}
