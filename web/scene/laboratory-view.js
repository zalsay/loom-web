const LABORATORY_NAME = '织界实验室';

export function createLaboratoryView(model) {
  const root = model?.root;
  const building = root?.getObjectByName('建筑');
  const laboratory = root?.getObjectByName(LABORATORY_NAME);
  if (!root || !building || !laboratory || laboratory.parent !== building) {
    throw new TypeError('model must contain 织界实验室 directly under 建筑');
  }

  // Resolve from this root, including the SVG clone, rather than the source model.
  // The garden is the real view through the glass, not a second scene or a backdrop.
  const surroundings = ['地面与铺装', '草坪与园林']
    .map((name) => root.getObjectByName(name))
    .filter((object) => object?.parent === root);

  let active = false;
  let visibilitySnapshot = null;

  function setActive(value) {
    const next = Boolean(value);
    if (next === active) return;

    if (next) {
      const controlled = [
        ...root.children.filter((child) => child !== building),
        ...building.children.filter((child) => child !== laboratory),
      ];
      const exteriorLogos = [];
      laboratory.traverse((object) => {
        if (object.userData.exteriorLogo === true) exteriorLogos.push(object);
      });
      controlled.push(building, laboratory, ...exteriorLogos);
      visibilitySnapshot = new Map(controlled.map((object) => [object, object.visible]));
      for (const object of controlled) object.visible = false;
      building.visible = true;
      laboratory.visible = true;
      // Snapshot these groups even when the outside landscape toggle was off.
      // Keep descendant visibility (e.g. fallback-hidden grass instances) intact.
      for (const object of surroundings) object.visible = true;
      active = true;
      return;
    }

    for (const [object, visible] of visibilitySnapshot ?? []) object.visible = visible;
    visibilitySnapshot = null;
    active = false;
  }

  return {
    setActive,
    get active() {
      return active;
    },
    dispose() {
      setActive(false);
    },
  };
}
