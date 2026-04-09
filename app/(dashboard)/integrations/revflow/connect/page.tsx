import { ConnectWithDiscovery } from "../../_components/connect-with-discovery";

export default function RevflowConnectPage() {
  return (
    <ConnectWithDiscovery
      source="revflow"
      productName="Revflow"
      connectPath="/api/integrations/revflow/connect"
      defaultUrl="https://revflowapp.com/api/finos"
      scopes={["Read campaigns", "Read invoices & payments", "Read journal entries"]}
    />
  );
}
