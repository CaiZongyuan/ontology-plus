import type { Bilingual, ConnectionManifest } from './contract.js';

/** The part of a confirmed Business Model object that the connection check reads. */
export interface ModelObjectRef {
  readonly id: string;
  readonly name: string;
  readonly alias: string;
}

export type ConnectionHintCode = 'NO_CONFIRMED_MODEL' | 'OBJECT_NOT_IN_MODEL' | 'OBJECT_WITHOUT_MODEL_LINK';

/** Something the user should know after connecting; it never blocks the connection. */
export interface ConnectionHint {
  readonly code: ConnectionHintCode;
  readonly objectId?: string;
  readonly message: Bilingual;
}

const norm = (s: string) => s.trim().toLowerCase();

/**
 * Checks each business object the application offers against the confirmed Business Model
 * (TeaCo spec §11.3). `modelObjects` is null when the project has no confirmed model yet.
 */
export function checkManifestAgainstModel(
  manifest: ConnectionManifest,
  modelObjects: readonly ModelObjectRef[] | null,
): ConnectionHint[] {
  if (!modelObjects || modelObjects.length === 0) {
    return [{
      code: 'NO_CONFIRMED_MODEL',
      message: {
        zh: '这个项目还没有确认业务模型，无法核对应用里的业务对象是否和模型一致。',
        en: 'This project has no confirmed Business Model yet, so the application’s business objects cannot be checked against it.',
      },
    }];
  }
  const known = new Set(modelObjects.flatMap((o) => [o.id, o.name, o.alias].filter(Boolean).map(norm)));
  const hints: ConnectionHint[] = [];
  for (const obj of manifest.objects) {
    if (!obj.modelObject) {
      hints.push({
        code: 'OBJECT_WITHOUT_MODEL_LINK',
        objectId: obj.id,
        message: { zh: `「${obj.name.zh}」没有说明对应业务模型里的哪个对象。`, en: `"${obj.name.en}" does not say which Business Model object it stands for.` },
      });
    } else if (!known.has(norm(obj.modelObject))) {
      hints.push({
        code: 'OBJECT_NOT_IN_MODEL',
        objectId: obj.id,
        message: {
          zh: `「${obj.name.zh}」对应的「${obj.modelObject}」在已确认的业务模型里找不到。`,
          en: `"${obj.name.en}" points to "${obj.modelObject}", which is not in the confirmed Business Model.`,
        },
      });
    }
  }
  return hints;
}
