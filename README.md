# Battery-aware MPC-ACC: live demo page
Static page for the demo of battery-aware MPC adaptive cruise control for EVs. It calls a rate-limited research API that runs the paper's frozen energy model, a conventional ACC and the MPC on a speed trace you provide. Research demo only; not a vehicle controller or a range estimate.
The demo runs entirely in the visitor's browser (Pyodide): https://ev.sagniknath.in/ redirects to v2/. old/ keeps the retired first version, which used an AWS backend that has been switched off.
