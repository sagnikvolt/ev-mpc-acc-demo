# Battery-aware MPC-ACC: live demo page
Static page for the demo of battery-aware MPC adaptive cruise control for EVs. It calls a rate-limited research API that runs the paper's frozen energy model, a conventional ACC and the MPC on a speed trace you provide. Research demo only; not a vehicle controller or a range estimate.
v2/ is the new demo that runs entirely in the visitor's browser (Pyodide); the root page is the older AWS-backed demo and will be replaced once v2 is verified.
