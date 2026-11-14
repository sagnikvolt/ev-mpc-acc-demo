% make_site_traces.m  Per-window traces + figures for the website "Run it" MATLAB mode (MATLAB R2024b).
% Does not modify verify_main.m. Helpers below are verbatim copies from make_site_figs.m / verify_main.m.
% Run from this folder:  make_site_traces  -> ../../demo_v2/figures/matlab/traces_w01..w10.png, site_traces/w01..w10.csv
clear; clc;
outdir = fullfile('..','..','demo_v2','figures','matlab'); if ~exist(outdir,'dir'), mkdir(outdir); end
if ~exist('site_traces','dir'), mkdir('site_traces'); end
R  = readtable('matlab_results.csv');
bg = [0.09 0.09 0.10]; fg = [0.88 0.88 0.88]; grid_c = [0.30 0.30 0.32];
cM = [0.93 0.62 0.20]; cW = [0.36 0.66 0.93];
P = readmatrix('data/params.csv');
S.CRR = P(1); S.C1 = P(2); S.C2 = P(3); S.R1 = P(4); S.R2 = P(5); S.B0 = P(6); S.CDA = P(10);
S.M = 1270; S.RHO = 1.2; S.G = 9.81; S.K = 0.5*S.RHO*S.CDA; S.ETA = 0.65; S.CAP = 35; S.VFADE = 3;
maxdiff = 0;
for wn = 1:10
    vl = readmatrix(sprintf('data/win_%d.csv', wn));
    TA = sim_acc_trace(vl, S); TM = sim_mpc_trace(vl, S);
    chkA = R.whkm_adj(R.n==wn & strcmp(R.arm,'acc')); chkM = R.whkm_adj(R.n==wn & strcmp(R.arm,'mpc_const'));
    dA = abs(TA.whkm_adj - chkA); dM = abs(TM.whkm_adj - chkM); maxdiff = max([maxdiff dA dM]);
    fprintf('w%02d ACC %.6f (csv %.6f) MPC %.6f (csv %.6f) absdiff %.2e %.2e\n', wn, TA.whkm_adj, chkA, TM.whkm_adj, chkM, dA, dM);
    t = TA.t; lead = vl(1 + 5*(0:numel(t)-1)); lead = lead(:);
    T = table(t, lead, TA.v, TA.d, TA.E, TM.v, TM.d, TM.E, 'VariableNames', {'t','vl','v_acc','gap_acc','E_acc_Wh','v_mpc','gap_mpc','E_mpc_Wh'});
    % note: columns gap_mpc/E_mpc_Wh come from TM
    writetable(T, sprintf('site_traces/w%02d.csv', wn));
    fig2 = figure('Color', bg, 'Units', 'inches', 'Position', [1 1 7.3 5.8], 'InvertHardcopy', 'off', 'Visible', 'off');
    tl2 = tiledlayout(fig2, 3, 1, 'TileSpacing', 'compact', 'Padding', 'compact');
    ax = nexttile(tl2); hold(ax,'on'); plot(ax, t, lead, '--', 'Color', [0.7 0.7 0.7], 'LineWidth', 1.2); plot(ax, t, TA.v, 'Color', cW, 'LineWidth', 1.6); plot(ax, t, TM.v, 'Color', cM, 'LineWidth', 1.6);
    ylabel(ax, 'Speed (m/s)'); legend(ax, {'Lead vehicle', 'ACC', 'MPC (const preview)'}, 'Location', 'northoutside', 'Orientation', 'horizontal', 'TextColor', fg, 'Color', bg, 'EdgeColor', grid_c, 'Box', 'off');
    ax2 = nexttile(tl2); hold(ax2,'on'); plot(ax2, t, TA.d, 'Color', cW, 'LineWidth', 1.6); plot(ax2, t, TM.d, 'Color', cM, 'LineWidth', 1.6); ylabel(ax2, 'Gap (m)');
    ax3 = nexttile(tl2); hold(ax3,'on'); plot(ax3, t, TA.E, 'Color', cW, 'LineWidth', 1.6); plot(ax3, t, TM.E, 'Color', cM, 'LineWidth', 1.6); ylabel(ax3, 'Cumulative energy (Wh)'); xlabel(ax3, 'Time (s)');
    for x = [ax ax2 ax3]
        set(x, 'Color', bg, 'XColor', fg, 'YColor', fg, 'GridColor', grid_c, 'GridAlpha', 1, 'FontSize', 10, 'Box', 'off'); x.YGrid = 'on';
    end
    title(tl2, sprintf('Window %d, MATLAB R2024b: ACC %.2f vs MPC %.2f Wh/km (energy-adjusted)', wn, TA.whkm_adj, TM.whkm_adj), 'Color', fg, 'FontSize', 11);
    exportgraphics(fig2, fullfile(outdir, sprintf('traces_w%02d.png', wn)), 'Resolution', 150, 'BackgroundColor', bg);
    close(fig2);
end
fprintf('max abs diff vs matlab_results.csv: %.3e\n', maxdiff);
disp('make_site_traces DONE');

function o = sim_acc_trace(vl, S)
    dtc = 0.5; dtp = 0.1; N = 30; nsteps = floor((numel(vl) - N*5 - 1)/5);
    v = vl(1); d = 5 + 1.5*v; aprev = 0; E = 0; dist = 0; dmin = 1e9; jerks = zeros(nsteps,1);
    tv = zeros(nsteps+1,1); td = tv; tE = tv; tv(1) = v; td(1) = d;
    for k = 0:nsteps-1
        i = 5*k; a = 0.4*(d - (5+1.5*v)) + 1.0*(vl(i+1) - v);
        a = min(max(a, aprev-1.5), aprev+1.5); a = min(max(a, -3.5), 2.0);
        if v >= 38 && a > 0, a = 0; end
        [v, d, E, dist, dmin] = plant(v, d, a, vl, i, E, dist, dmin, dtp, S);
        jerks(k+1) = (a - aprev)/dtc; aprev = a; tv(k+2) = v; td(k+2) = d; tE(k+2) = E;
    end
    o = metrics(E, dist, dmin, jerks, v, vl(1), 0, S); o.t = (0:nsteps)'*dtc; o.v = tv; o.d = td; o.E = tE;
end
function o = sim_mpc_trace(vl, S)
    dtc = 0.5; dtp = 0.1; N = 30; nsteps = floor((numel(vl) - N*5 - 1)/5);
    v = vl(1); d = 5 + 1.5*v; aprev = 0; E = 0; dist = 0; dmin = 1e9; jerks = zeros(nsteps,1); vrprev = []; nfail = 0;
    tv = zeros(nsteps+1,1); td = tv; tE = tv; tv(1) = v; td(1) = d;
    for k = 0:nsteps-1
        i = 5*k; [ok, a, vrprev] = mpc_solve(v, d, repmat(vl(i+1), N, 1), aprev, vrprev, S);
        if ~ok, nfail = nfail + 1; end
        [v, d, E, dist, dmin] = plant(v, d, a, vl, i, E, dist, dmin, dtp, S);
        jerks(k+1) = (a - aprev)/dtc; aprev = a; tv(k+2) = v; td(k+2) = d; tE(k+2) = E;
    end
    o = metrics(E, dist, dmin, jerks, v, vl(1), nfail, S); o.t = (0:nsteps)'*dtc; o.v = tv; o.d = td; o.E = tE;
end

function pw = pwkw(v0, v1, dt, S)
    vb = 0.5*(v0+v1); a = (v1-v0)/dt;
    pw = ((S.M*a + S.M*S.G*S.CRR).*vb + S.K*vb.^3)/1000;
end
function pb = pbkw(pw, v, S)
    fade = min(1, v/S.VFADE); pc = max(pw, -S.CAP);
    if pw >= 0, pb = S.C1*pw + S.C2*pw^2; else, pb = S.ETA*fade*(S.R1*pc + S.R2*pc^2); end
    pb = pb + S.B0/1000;
end
function [g0, g1] = gradpw(v0, v1, dt, S)
    vb = 0.5*(v0+v1); a = (v1-v0)/dt; f = S.M*a + S.M*S.G*S.CRR;
    g1 = (S.M/dt*vb + 0.5*f + 1.5*S.K*vb.^2)/1000;
    g0 = (-S.M/dt*vb + 0.5*f + 1.5*S.K*vb.^2)/1000;
end
function [v, d, E, dist, dmin] = plant(v, d, a, vl, i, E, dist, dmin, dtp, S)
    for q = 0:4
        j = i + q; v1 = max(0, v + a*dtp);
        E = E + pbkw(pwkw(v, v1, dtp, S), 0.5*(v+v1), S)*dtp/3.6;
        d = d + (vl(j+1) - 0.5*(v+v1))*dtp; dist = dist + 0.5*(v+v1)*dtp; v = v1; dmin = min(dmin, d);
    end
end
function o = metrics(E, dist, dmin, jerks, v, v0, nfail, S)
    dke = 0.5*S.M*(v^2 - v0^2)/3600;
    o = struct('whkm_adj', (E - dke*0.9)/dist*1000, 'whkm', E/dist*1000, 'dmin', dmin, 'jerk_rms', sqrt(mean(jerks.^2)), 'v_end', v, 'fail', nfail);
end
function [ok, a, vr] = mpc_solve(v0, d0, vlp, aprev, vrprev, S)
    N = 30; dt = 0.5; th = 1.5; dd = 5; vmax = 38; amin = -3.5; amax = 2; jmax = 3; wgap = 0.2; wtr = 0.08; wsl = 200; pbmax = 50;
    dmina = 4; dminb = 0.7; banda = 3; bandb = 0.25; passes = 3;
    if isempty(vrprev), vr = repmat(v0, N+1, 1); else, vr = [vrprev(2:end); vrprev(end)]; end
    vr(1) = v0; nv = N+1; iv = 1:nv; id = nv+(1:nv); isl = 2*nv+(1:nv); iel = 3*nv+(1:nv); ieh = 4*nv+(1:nv); it = 5*nv+(1:N); nx = 5*nv+N;
    opts = optimoptions('quadprog', 'Algorithm', 'interior-point-convex', 'Display', 'off', 'OptimalityTolerance', 1e-9, 'ConstraintTolerance', 1e-9, 'StepTolerance', 1e-12);
    ok = true;
    for pass = 1:passes
        va = vr(1:N); vb = vr(2:N+1); [g0, g1] = gradpw(va, vb, dt, S); p0 = pwkw(va, vb, dt, S);
        A1 = g0; A2 = g1; A0 = p0 - g0.*va - g1.*vb;
        gk = S.ETA*S.R1*min(1, 0.5*(va+vb)/S.VFADE); pg0 = gk.*A0; pg1 = gk.*A1; pg2 = gk.*A2; pfl = -S.CAP*gk;
        H = sparse(nx, nx); H(sub2ind([nx nx], iv, iv)) = 2*wtr; H(sub2ind([nx nx], iel, iel)) = 2*wgap; H(sub2ind([nx nx], ieh, ieh)) = 2*wgap;
        f = zeros(nx,1); f(iv) = -2*wtr*vr; f(isl) = wsl; f(it) = dt/3.6;
        % equalities: v(1)=v0, d(1)=d0, gap dynamics
        Aeq = sparse(2+N, nx); beq = zeros(2+N,1); Aeq(1, iv(1)) = 1; beq(1) = v0; Aeq(2, id(1)) = 1; beq(2) = d0;
        for k = 1:N
            r = 2+k; Aeq(r, id(k+1)) = 1; Aeq(r, id(k)) = -1; Aeq(r, iv(k)) = dt/2; Aeq(r, iv(k+1)) = dt/2; beq(r) = dt*vlp(k);
        end
        L = struct('r', 0, 'I', [], 'J', [], 'V', [], 'b', []);
        for k = 1:N
            L = addrow(L, [iv(k) iv(k+1)], [-1 1], amax*dt);                         % a <= amax
            L = addrow(L, [iv(k) iv(k+1)], [1 -1], -amin*dt);                        % a >= amin
            L = addrow(L, [iv(k) iv(k+1)], S.C1*[A1(k) A2(k)], pbmax - S.C1*A0(k));  % C1*pw <= pbmax
            L = addrow(L, [iv(k) iv(k+1) it(k)], [S.C1*A1(k) S.C1*A2(k) -1], -S.C1*A0(k));   % t >= C1*pw
            L = addrow(L, [iv(k) iv(k+1) it(k)], [pg1(k) pg2(k) -1], -pg0(k));                % t >= g*pw
        end
        L = addrow(L, [iv(1) iv(2)], [-1 1]/dt, aprev + jmax*dt); L = addrow(L, [iv(1) iv(2)], [1 -1]/dt, -aprev + jmax*dt);
        for k = 1:N-1
            L = addrow(L, [iv(k) iv(k+1) iv(k+2)], [1 -2 1]/dt, jmax*dt); L = addrow(L, [iv(k) iv(k+1) iv(k+2)], [-1 2 -1]/dt, jmax*dt);
        end
        for k = 1:nv
            L = addrow(L, [id(k) iv(k) isl(k)], [-1 dminb -1], -dmina);                      % d >= dmin(v) - sl
            L = addrow(L, [id(k) iv(k) iel(k)], [-1 (th - bandb) -1], banda - dd);           % d - ddes >= -band - el
            L = addrow(L, [id(k) iv(k) ieh(k)], [1 -(th + bandb) -1], dd + banda);           % d - ddes <= band + eh
        end
        Ain = sparse(L.I, L.J, L.V, L.r, nx); bin = L.b;
        lb = -inf(nx,1); ub = inf(nx,1); lb(iv) = 0; ub(iv) = vmax; lb(isl) = 0; lb(iel) = 0; lb(ieh) = 0; lb(it) = pfl;
        x0 = zeros(nx,1); x0(iv) = vr;
        [x, ~, ef] = quadprog(H, f, Ain, bin, Aeq, beq, lb, ub, x0, opts);
        if ef <= 0 || isempty(x), ok = false; break; end
        vr = x(iv);
    end
    if ok, a = (vr(2) - vr(1))/dt; else, a = -1.0; vr = []; end
end

function L = addrow(L, cols, vals, rhs)
    L.r = L.r + 1; L.I = [L.I; L.r*ones(numel(cols),1)]; L.J = [L.J; cols(:)]; L.V = [L.V; vals(:)]; L.b = [L.b; rhs];
end
