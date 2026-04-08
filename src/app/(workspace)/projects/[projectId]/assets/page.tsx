import AssetCenterClient from "@/components/project-assets/asset-center-client";
import { requireUser } from "@/lib/auth/guards";
import { getProjectWorkflowBinding } from "@/lib/services/asset-bindings";
import { listProjectAssets } from "@/lib/services/assets";

type PageProps = {
  params: Promise<{ projectId: string }> | { projectId: string };
};

export default async function ProjectAssetsPage({ params }: PageProps) {
  const [{ projectId }, user] = await Promise.all([
    Promise.resolve(params),
    requireUser(),
  ]);
  const [assetPayload, bindings] = await Promise.all([
    listProjectAssets(projectId, user.userId),
    getProjectWorkflowBinding(projectId, user.userId),
  ]);

  return (
    <AssetCenterClient
      project={assetPayload.project}
      initialAssets={assetPayload.assets}
      initialBindings={bindings}
    />
  );
}
