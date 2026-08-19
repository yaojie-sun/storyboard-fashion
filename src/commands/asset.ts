import { invoke } from '@tauri-apps/api/core';

export interface AssetRecord {
  id: string;
  projectId: string;
  category: string;
  name: string;
  filePath: string;
  fileName: string;
  createdAt: number;
}

export type AssetCategory = 'character' | 'scene' | 'costume_prop';

export async function addAsset(
  id: string,
  projectId: string,
  category: string,
  name: string,
  sourcePath: string,
  fileName: string,
): Promise<AssetRecord> {
  return await invoke<AssetRecord>('add_asset', {
    id,
    projectId,
    category,
    name,
    sourcePath,
    fileName,
  });
}

export async function updateAsset(
  id: string,
  name: string,
  category: string,
): Promise<AssetRecord> {
  return await invoke<AssetRecord>('update_asset', { id, name, category });
}

export async function listAssets(projectId: string): Promise<AssetRecord[]> {
  return await invoke<AssetRecord[]>('list_assets', { projectId });
}

export async function deleteAsset(id: string): Promise<void> {
  await invoke('delete_asset', { id });
}

export interface AssetDescription {
  assetId: string;
  description: string;
}

export async function describeAsset(id: string): Promise<string | null> {
  return await invoke<string | null>('describe_asset', { assetId: id });
}

export async function getAssetDescriptions(projectId: string): Promise<AssetDescription[]> {
  return await invoke<AssetDescription[]>('get_asset_descriptions', { projectId });
}

// 组装 Chat context 用的 @图N 参考图行（含视觉描述，缺失时后台补读）。
// 行业无关，复刻到服饰版/美妆版等衍生版本时无需改动。
export async function buildAssetReferenceLines(projectId: string): Promise<string[]> {
  const assets = await listAssets(projectId);
  if (assets.length === 0) return [];

  const descMap = new Map<string, string>();
  const apply = (descArr: AssetDescription[]) => {
    for (const d of descArr) descMap.set(d.assetId, d.description);
  };
  apply(await getAssetDescriptions(projectId).catch(() => []));

  // 缺失描述的资产阻塞补读：读图未就绪时等待其完成，确保本次返回就带上视觉描述。
  // （后端已做并发合并，同一张图不会重复计费，等待方复用进行中的读图结果。）
  const missing = assets.filter((a) => !descMap.has(a.id));
  if (missing.length > 0) {
    await Promise.allSettled(missing.map((a) => describeAsset(a.id).catch(() => null)));
    apply(await getAssetDescriptions(projectId).catch(() => []));
  }

  const catLabel = (cat: string) =>
    cat === 'character' ? '角色' : cat === 'scene' ? '场景' : '服饰道具';

  return assets.map((a, i) => {
    const base = `@图${i + 1}: ${a.name} (${catLabel(a.category)})`;
    const desc = descMap.get(a.id);
    return desc ? `${base}\n  视觉描述：${desc}` : base;
  });
}
