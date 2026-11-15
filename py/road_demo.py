"""Road options for the website (Round m). Two things live here, kept apart on purpose.
1. SPEED BREAKERS: not defined here. They come from scenarios.py, an unchanged copy of the paper's python/scenarios.py (S1b: s1_breakers,
   same generator and the same parameters; seed 7100 + window number on the test windows).
2. POTHOLES: NOT part of the paper. A demo-only extra. Every number below is ASSUMED, chosen only to make the effect visible; none was measured.
   A pothole is a short stretch of road with extra rolling resistance. It changes the battery energy only: the controllers do not know about it and
   their speeds, gaps and decisions are the same as on the road without potholes. Every controller meets the same potholes at the same road positions."""
import numpy as np
PIT_SEED = 4242        # assumed: fixes the pothole positions, the same for every window and every controller
PIT_FIRST_M = (60.0, 140.0)    # assumed: first pothole between these distances (m) from the start
PIT_SPACING_M = (90.0, 220.0)  # assumed: gap between potholes (m)
PIT_LEN_M = 3.0        # assumed: length of one rough stretch (m)
PIT_FORCE_N = 800.0    # assumed: extra rolling-resistance force on the car while it is on the rough stretch (N)
PIT_MAX_M = 6000.0
def pothole_positions():
    """[(start_m, end_m), ...] along the lane, measured from where the follower starts (same frame as the breakers)."""
    rng = np.random.default_rng(PIT_SEED); x = rng.uniform(*PIT_FIRST_M); out = []
    while x < PIT_MAX_M: out.append((float(x), float(x + PIT_LEN_M))); x += PIT_LEN_M + rng.uniform(*PIT_SPACING_M)
    return out
def params():
    return dict(seed=PIT_SEED, length_m=PIT_LEN_M, force_n=PIT_FORCE_N, spacing_m=list(PIT_SPACING_M), first_m=list(PIT_FIRST_M))
