import { Router } from 'express';
import { MODULE_TEMPLATES, MODULE_TEMPLATE_GROUPS } from '../data/module-templates.js';

// Read-only starter catalog. The coach browses this (list_module_templates) to
// propose a tailored set during onboarding; instantiate via POST /modules/from-template.
const router = Router();

router.get('/', (_req, res) => {
  res.json({ groups: MODULE_TEMPLATE_GROUPS, templates: MODULE_TEMPLATES });
});

export default router;
