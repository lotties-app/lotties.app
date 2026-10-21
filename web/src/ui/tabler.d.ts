/** Per-icon deep imports of Tabler (the package ships types only for its barrel). */
declare module '@tabler/icons-react/dist/esm/icons/*.mjs' {
  import type { TablerIcon } from '@tabler/icons-react';
  const Icon: TablerIcon;
  export default Icon;
}
