import { ConnectWithDiscovery } from "../../_components/connect-with-discovery";

export default function XpenxFlowConnectPage() {
  return (
    <ConnectWithDiscovery
      source="xpenxflow"
      productName="XpenxFlow"
      connectPath="/api/integrations/xpenxflow/connect"
      defaultUrl="https://api.xpenxflow.com"
      scopes={["Read expense claims", "Read bills & vendor payments", "Read budget data"]}
    />
  );
}
