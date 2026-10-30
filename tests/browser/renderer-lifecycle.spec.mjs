import { test, expect } from '@playwright/test';

test('renderer rebuilds seeded templates and releases isolated resources exactly once', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.route('**/js/editor/app.js', (route) =>
    route.fulfill({ status: 200, contentType: 'text/javascript', body: '' }),
  );
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...args) {
      if (type === 'webgl2' || type === 'webgl') return null;
      return getContext.call(this, type, ...args);
    };
  });
  await page.goto('/create.html');

  const result = await page.evaluate(async () => {
    const THREE = await import('/vendor/three.module.js');
    const { createSpaceRenderer } = await import('/js/editor/renderer.js');
    const { applyOperations, createDefaultScene, validateSceneDocument } = await import(
      '/js/editor/document.js'
    );
    const tracked = { geometries: new Set(), materials: new Set(), textures: new Set() };
    const disposalBaselines = {
      geometries: new Map(),
      materials: new Map(),
      textures: new Map(),
    };
    const disposed = {
      geometries: new Map(),
      materials: new Map(),
      textures: new Map(),
    };
    const trackResource = (kind, resource) => {
      if (!resource) return;
      if (!tracked[kind].has(resource)) {
        disposalBaselines[kind].set(resource, disposed[kind].get(resource) || 0);
        tracked[kind].add(resource);
      }
    };
    const disposalCount = (kind, resource) =>
      (disposed[kind].get(resource) || 0) - (disposalBaselines[kind].get(resource) || 0);
    const templateResources = [];
    const selectionHelpers = [];
    const renderers = [];
    const restores = [];

    const trackMaterial = (value) => {
      for (const material of Array.isArray(value) ? value : [value]) {
        if (!material?.isMaterial) continue;
        trackResource('materials', material);
        for (const entry of Object.values(material)) {
          if (entry?.isTexture) trackResource('textures', entry);
          else if (Array.isArray(entry)) {
            for (const item of entry) if (item?.isTexture) trackResource('textures', item);
          }
        }
        for (const uniform of Object.values(material.uniforms || {})) {
          const entry = uniform?.value;
          if (entry?.isTexture) trackResource('textures', entry);
          else if (Array.isArray(entry)) {
            for (const item of entry) if (item?.isTexture) trackResource('textures', item);
          }
        }
      }
    };
    const trackObject = (object) => {
      if (object.geometry?.isBufferGeometry) trackResource('geometries', object.geometry);
      trackMaterial(object.material);
    };
    const watchMeshResourceReplacements = (object) => {
      for (const property of ['geometry', 'material']) {
        const descriptor = Object.getOwnPropertyDescriptor(object, property);
        if (!descriptor || !('value' in descriptor)) continue;
        let value = descriptor.value;
        const track =
          property === 'geometry'
            ? (entry) => {
                if (entry?.isBufferGeometry) trackResource('geometries', entry);
              }
            : trackMaterial;
        track(value);
        Object.defineProperty(object, property, {
          configurable: true,
          enumerable: descriptor.enumerable,
          get: () => value,
          set: (next) => {
            value = next;
            track(next);
          },
        });
        restores.push(() => Object.defineProperty(object, property, descriptor));
      }
    };
    const watchDisposals = (constructor, kind) => {
      const original = constructor.prototype.dispose;
      constructor.prototype.dispose = function (...args) {
        disposed[kind].set(this, (disposed[kind].get(this) || 0) + 1);
        return original.apply(this, args);
      };
      restores.push(() => {
        constructor.prototype.dispose = original;
      });
    };

    watchDisposals(THREE.BufferGeometry, 'geometries');
    watchDisposals(THREE.Material, 'materials');
    watchDisposals(THREE.Texture, 'textures');

    const originalAdd = THREE.Object3D.prototype.add;
    THREE.Object3D.prototype.add = function (...objects) {
      const result = originalAdd.apply(this, objects);
      for (const child of objects) {
        if (child.name === '视频还原 · 白色折柱廊亭') {
          const instance = { geometries: new Set(), materials: new Set(), textures: new Set() };
          child.traverse((object) => {
            trackObject(object);
            watchMeshResourceReplacements(object);
            if (object.geometry?.isBufferGeometry) instance.geometries.add(object.geometry);
            for (const material of Array.isArray(object.material)
              ? object.material
              : [object.material]) {
              if (!material?.isMaterial) continue;
              instance.materials.add(material);
              for (const value of Object.values(material)) {
                if (value?.isTexture) instance.textures.add(value);
              }
            }
          });
          templateResources.push(instance);
        }
        if (child.userData?.sceneObjectId) {
          child.traverse((object) => {
            trackObject(object);
            watchMeshResourceReplacements(object);
          });
        }
        if (child.type === 'Box3Helper') {
          trackObject(child);
          selectionHelpers.push({ geometry: child.geometry, material: child.material });
        }
      }
      return result;
    };
    restores.push(() => {
      THREE.Object3D.prototype.add = originalAdd;
    });

    const originalRequestAnimationFrame = window.requestAnimationFrame;
    const originalCancelAnimationFrame = window.cancelAnimationFrame;
    let nextFrame = 1;
    const queuedFrames = new Set();
    window.requestAnimationFrame = () => {
      const id = nextFrame++;
      queuedFrames.add(id);
      return id;
    };
    window.cancelAnimationFrame = (id) => queuedFrames.delete(id);
    restores.push(() => {
      window.requestAnimationFrame = originalRequestAnimationFrame;
      window.cancelAnimationFrame = originalCancelAnimationFrame;
    });

    const firstContainer = document.createElement('div');
    const secondContainer = document.createElement('div');
    for (const container of [firstContainer, secondContainer]) {
      container.style.width = '640px';
      container.style.height = '480px';
      document.body.append(container);
    }
    const selectionChanges = [];
    try {
      const first = await createSpaceRenderer({
        container: firstContainer,
        onSelect: (id) => selectionChanges.push(id),
      });
      renderers.push(first);
      const second = await createSpaceRenderer({ container: secondContainer });
      renderers.push(second);

      const firstScene = applyOperations(createDefaultScene({ seed: 4917 }), [
        {
          op: 'add_object',
          id: 'bench-one',
          assetId: 'garden.bench.wood',
          name: '测试长椅',
          materialId: 'wood.warm-oak',
          transform: { position: [1, 0, 2], rotation: [0, 0, 0], scale: [1, 1, 1] },
        },
        {
          op: 'set_material',
          target: { kind: 'template', targetId: 'pavilion.frame', materialSlot: 'surface' },
          materialId: 'metal.graphite',
        },
      ]);
      const secondScene = createDefaultScene({ seed: 4917 });
      first.setScene(firstScene);
      second.setScene(secondScene);

      const firstResources = templateResources[0];
      const secondResources = templateResources[1];
      if (!firstResources || !secondResources)
        throw new Error('renderer did not attach both models');
      const overlaps = Object.fromEntries(
        Object.keys(firstResources).map((kind) => [
          kind,
          [...firstResources[kind]].filter((resource) => secondResources[kind].has(resource))
            .length,
        ]),
      );

      first.setSelection('bench-one');
      const helper = selectionHelpers.at(-1);
      if (!helper) throw new Error('selected object did not create a box helper');
      const withoutBench = validateSceneDocument({
        ...firstScene,
        seed: 4918,
        objects: [],
        templateOverrides: [],
      });
      first.setScene(withoutBench);
      const helperDisposalsOnRemoval = {
        geometry: disposalCount('geometries', helper.geometry),
        material: disposalCount('materials', helper.material),
      };

      const nextFirstScene = validateSceneDocument({
        ...withoutBench,
        seed: 4919,
        templateOverrides: [
          { targetId: 'pavilion.roof', materialSlot: 'surface', materialId: 'plaster.ivory' },
        ],
      });
      const nextSecondScene = validateSceneDocument({ ...secondScene, seed: 4918 });
      first.setScene(nextFirstScene);
      second.setScene(nextSecondScene);
      first.dispose();
      second.dispose();
      renderers.length = 0;

      const disposalSummary = Object.fromEntries(
        Object.entries(tracked).map(([kind, resources]) => [
          kind,
          [...resources].reduce(
            (summary, resource) => {
              const count = disposalCount(kind, resource);
              summary[count === 0 ? 'never' : count === 1 ? 'once' : 'multiple']++;
              return summary;
            },
            { never: 0, once: 0, multiple: 0 },
          ),
        ]),
      );
      const resourceNames = Object.fromEntries(
        Object.entries(tracked).map(([kind, resources]) => [
          kind,
          [...resources]
            .filter((resource) => disposalCount(kind, resource) !== 1)
            .map((resource) => ({
              name: resource.name || resource.type || resource.constructor.name,
              count: disposalCount(kind, resource),
              uuid: resource.uuid,
            }))
            .slice(0, 30),
        ]),
      );
      return {
        mode: 'svg',
        overlaps,
        helperDisposalsOnRemoval,
        selectionCleared: selectionChanges.includes(null),
        disposalSummary,
        resourceNames,
        tracked: Object.fromEntries(
          Object.entries(tracked).map(([kind, resources]) => [kind, resources.size]),
        ),
      };
    } finally {
      for (const renderer of renderers.reverse()) renderer.dispose();
      for (const restore of restores.reverse()) restore();
      firstContainer.remove();
      secondContainer.remove();
    }
  });

  expect(result.overlaps).toEqual({ geometries: 0, materials: 0, textures: 0 });
  expect(result.helperDisposalsOnRemoval).toEqual({ geometry: 1, material: 1 });
  expect(result.selectionCleared).toBe(true);
  expect(result.disposalSummary, JSON.stringify(result.resourceNames)).toEqual({
    geometries: { never: 0, once: result.tracked.geometries, multiple: 0 },
    materials: { never: 0, once: result.tracked.materials, multiple: 0 },
    textures: { never: 0, once: result.tracked.textures, multiple: 0 },
  });
  expect(result.tracked.geometries).toBeGreaterThan(0);
  expect(result.tracked.materials).toBeGreaterThan(0);
  expect(result.tracked.textures).toBeGreaterThan(0);
});
