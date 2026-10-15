// Lab page for the workflow figure (lab/workflow.html): the figure alone, for the anatomy checks.
import '../styles/site.css';
import { mountWorkflow } from '../figures/workflow/live';

Object.assign(window, { __wf: mountWorkflow(document.getElementById('fig')!) });
