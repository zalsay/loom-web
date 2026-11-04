const LABORATORY_NAME = '织界实验室';

export function createLaboratoryView(model) {
  const root = model?.root;
  const building = root?.getObjectByName('建筑');
  const laboratory = root?.getObjectByName(LABORATORY_NAME);
  if (!root || !building || !laboratory || laboratory.parent !== building) {
    throw new TypeError('model must contain 织界实验室 directly under 建筑');
  }

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
