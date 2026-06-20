import Phaser from 'phaser';
import overlayUrl from '../assets/overlay.svg';

const TEAM_A_COLOR = 0x00ffff;
const TEAM_B_COLOR = 0xff3399;
const BALL_COLOR = 0xffffff;
const PLAYER_RADIUS = 10;
const BALL_RADIUS = 7;
const PLAYER_SPEED = 90;
const KICK_SPEED = 340;
const KICK_RANGE = 26;
const FRICTION = 0.97;
const SEP_DIST = PLAYER_RADIUS * 3.5;

type Role = 'gk' | 'cb' | 'mf' | 'st';

// Home positions as field fractions [x, y] for team 0 (attacks right)
const HOME_POS: Record<Role, [number, number][]> = {
  gk: [[0.04, 0.50]],
  cb: [[0.16, 0.32], [0.16, 0.68]],
  mf: [[0.40, 0.22], [0.40, 0.78]],
  st: [[0.70, 0.50]],
};

interface Player {
  gfx: Phaser.GameObjects.Graphics;
  glow: Phaser.GameObjects.Graphics;
  x: number;
  y: number;
  vx: number;
  vy: number;
  team: 0 | 1;
  role: Role;
  homeX: number;
  homeY: number;
  kickCooldown: number;
  pressing: boolean;
}

interface Ball {
  gfx: Phaser.GameObjects.Graphics;
  glow: Phaser.GameObjects.Graphics;
  trail: Phaser.GameObjects.Graphics;
  x: number;
  y: number;
  vx: number;
  vy: number;
  trailPoints: { x: number; y: number }[];
}

export class FootballScene extends Phaser.Scene {
  private players: Player[] = [];
  private ball!: Ball;
  private fieldGfx!: Phaser.GameObjects.Graphics;
  private bgGfx!: Phaser.GameObjects.Graphics;
  private scanlineGfx!: Phaser.GameObjects.Graphics;
  private ledTime = 0;
  private W = 0;
  private H = 0;
  private FW = 0;
  private FH = 0;
  private FX = 0;
  private FY = 0;

  constructor() {
    super({ key: 'FootballScene' });
  }

  preload() {
    this.load.svg('overlay', overlayUrl);
  }

  create() {
    this.W = this.scale.width;
    this.H = this.scale.height;
    this.FW = this.W;
    this.FH = this.H;
    this.FX = 0;
    this.FY = 0;

    this.bgGfx = this.add.graphics();
    this.fieldGfx = this.add.graphics();
    this.ball = this.createBall();
    this.createPlayers();
    this.scanlineGfx = this.add.graphics();
    this.drawScanlines();

    this.add.image(this.W / 2, this.H / 2, 'overlay');
  }

  private createBall(): Ball {
    const trailGfx = this.add.graphics();
    const glowGfx = this.add.graphics();
    const gfx = this.add.graphics();
    return {
      gfx,
      glow: glowGfx,
      trail: trailGfx,
      x: this.FX + this.FW / 2,
      y: this.FY + this.FH / 2,
      vx: Phaser.Math.FloatBetween(-100, 100),
      vy: Phaser.Math.FloatBetween(-60, 60),
      trailPoints: [],
    };
  }

  private createPlayers() {
    const roles: Role[] = ['gk', 'cb', 'cb', 'mf', 'mf', 'st'];

    for (let team = 0; team < 2; team++) {
      const ri: Record<Role, number> = { gk: 0, cb: 0, mf: 0, st: 0 };
      for (const role of roles) {
        const idx = ri[role];
        ri[role]++;
        const [hxBase, hyBase] = HOME_POS[role][idx];
        const hx = team === 0 ? hxBase : 1 - hxBase;

        this.players.push({
          gfx: this.add.graphics(),
          glow: this.add.graphics(),
          x: this.FX + this.FW * hx + Phaser.Math.FloatBetween(-15, 15),
          y: this.FY + this.FH * hyBase + Phaser.Math.FloatBetween(-15, 15),
          vx: 0,
          vy: 0,
          team: team as 0 | 1,
          role,
          homeX: hx,
          homeY: hyBase,
          kickCooldown: Phaser.Math.FloatBetween(0, 1),
          pressing: false,
        });
      }
    }
  }

  private drawScanlines() {
    this.scanlineGfx.clear();
    this.scanlineGfx.setAlpha(0.04);
    this.scanlineGfx.fillStyle(0x000000, 1);
    for (let y = 0; y < this.H; y += 3) {
      this.scanlineGfx.fillRect(0, y, this.W, 1);
    }
  }

  update(_time: number, delta: number) {
    const dt = Math.min(delta / 1000, 0.05);
    this.ledTime += dt;

    this.drawBackground();
    this.drawField();
    this.updateBall(dt);
    this.updatePlayers(dt);
    this.drawBall();
    this.drawPlayers();
  }

  private hslToHex(h: number, s: number, l: number): number {
    h = ((h % 360) + 360) % 360;
    s /= 100; l /= 100;
    const a = s * Math.min(l, 1 - l);
    const f = (n: number) => {
      const k = (n + h / 30) % 12;
      const color = l - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)));
      return Math.round(255 * color);
    };
    return (f(0) << 16) | (f(8) << 8) | f(4);
  }

  private drawBackground() {
    this.bgGfx.clear();
    // Deep dark base
    this.bgGfx.fillStyle(0x02020a, 1);
    this.bgGfx.fillRect(0, 0, this.W, this.H);

  }

  private drawField() {
    const g = this.fieldGfx;
    g.clear();

    const hue = (this.ledTime * 15) % 360;
    const lineColor = 0xe8f0e8;
    const lineAlpha = 0.85;

    // Field surface with subtle stripes
    for (let stripe = 0; stripe < 8; stripe++) {
      const sx = this.FX + (this.FW / 8) * stripe;
      const stripeHue = (hue * 0.1 + 130 + stripe * 2) % 360;
      const sc = this.hslToHex(stripeHue, 80, stripe % 2 === 0 ? 10 : 13);
      g.fillStyle(sc, 1);
      g.fillRect(sx, this.FY, this.FW / 8, this.FH);
    }

    g.lineStyle(2, lineColor, lineAlpha);

    // Outer boundary
    g.strokeRect(this.FX, this.FY, this.FW, this.FH);

    // Centre line
    g.beginPath();
    g.moveTo(this.FX + this.FW / 2, this.FY);
    g.lineTo(this.FX + this.FW / 2, this.FY + this.FH);
    g.strokePath();

    // Centre circle
    g.strokeCircle(this.FX + this.FW / 2, this.FY + this.FH / 2, this.FH * 0.18);

    // Centre dot
    g.fillStyle(lineColor, lineAlpha);
    g.fillCircle(this.FX + this.FW / 2, this.FY + this.FH / 2, 3);

    // Penalty areas
    const paW = this.FW * 0.14;
    const paH = this.FH * 0.45;
    const paY = this.FY + (this.FH - paH) / 2;
    g.strokeRect(this.FX, paY, paW, paH);
    g.strokeRect(this.FX + this.FW - paW, paY, paW, paH);

    // Goal mouths
    const gmW = this.FW * 0.02;
    const gmH = this.FH * 0.22;
    const gmY = this.FY + (this.FH - gmH) / 2;
    g.lineStyle(3, lineColor, lineAlpha);
    g.strokeRect(this.FX - gmW, gmY, gmW, gmH);
    g.strokeRect(this.FX + this.FW, gmY, gmW, gmH);

    // Corner arcs
    const cr = 14;
    g.lineStyle(2, lineColor, lineAlpha);
    g.beginPath(); g.arc(this.FX, this.FY, cr, 0, Math.PI / 2); g.strokePath();
    g.beginPath(); g.arc(this.FX + this.FW, this.FY, cr, Math.PI / 2, Math.PI); g.strokePath();
    g.beginPath(); g.arc(this.FX, this.FY + this.FH, cr, -Math.PI / 2, 0); g.strokePath();
    g.beginPath(); g.arc(this.FX + this.FW, this.FY + this.FH, cr, Math.PI, -Math.PI / 2); g.strokePath();
  }

  private updateBall(dt: number) {
    this.ball.x += this.ball.vx * dt;
    this.ball.y += this.ball.vy * dt;
    this.ball.vx *= Math.pow(FRICTION, dt * 60);
    this.ball.vy *= Math.pow(FRICTION, dt * 60);

    // Wall bounces
    if (this.ball.x < this.FX + BALL_RADIUS) { this.ball.x = this.FX + BALL_RADIUS; this.ball.vx = Math.abs(this.ball.vx) * 0.7; }
    if (this.ball.x > this.FX + this.FW - BALL_RADIUS) { this.ball.x = this.FX + this.FW - BALL_RADIUS; this.ball.vx = -Math.abs(this.ball.vx) * 0.7; }
    if (this.ball.y < this.FY + BALL_RADIUS) { this.ball.y = this.FY + BALL_RADIUS; this.ball.vy = Math.abs(this.ball.vy) * 0.7; }
    if (this.ball.y > this.FY + this.FH - BALL_RADIUS) { this.ball.y = this.FY + this.FH - BALL_RADIUS; this.ball.vy = -Math.abs(this.ball.vy) * 0.7; }

    // Trail
    this.ball.trailPoints.push({ x: this.ball.x, y: this.ball.y });
    if (this.ball.trailPoints.length > 18) this.ball.trailPoints.shift();
  }

  private updatePlayers(dt: number) {
    const ballFracY = (this.ball.y - this.FY) / this.FH;

    // One presser per team: closest non-GK to ball
    for (let team = 0; team < 2; team++) {
      const teamPlayers = this.players.filter(p => p.team === team);
      for (const p of teamPlayers) p.pressing = false;

      const nonGK = teamPlayers
        .filter(p => p.role !== 'gk')
        .sort((a, b) =>
          Math.hypot(a.x - this.ball.x, a.y - this.ball.y) -
          Math.hypot(b.x - this.ball.x, b.y - this.ball.y)
        );
      if (nonGK.length > 0) nonGK[0].pressing = true;

      // GK charges only when ball is very close to goal mouth
      const gk = teamPlayers.find(p => p.role === 'gk');
      if (gk) {
        const goalX = team === 0 ? this.FX : this.FX + this.FW;
        const inBox = Math.abs(this.ball.x - goalX) < this.FW * 0.14 &&
                      Math.abs(this.ball.y - (this.FY + this.FH * 0.5)) < this.FH * 0.2;
        if (inBox) gk.pressing = true;
      }
    }

    for (const p of this.players) {
      p.kickCooldown = Math.max(0, p.kickCooldown - dt);

      const dx = this.ball.x - p.x;
      const dy = this.ball.y - p.y;
      const dist = Math.hypot(dx, dy);

      if (dist < KICK_RANGE && p.kickCooldown === 0) {
        const targetX = p.team === 0 ? this.FX + this.FW + 50 : this.FX - 50;
        const tDx = targetX - this.ball.x + Phaser.Math.FloatBetween(-55, 55);
        const tDy = (this.FY + this.FH / 2) - this.ball.y + Phaser.Math.FloatBetween(-70, 70);
        const tLen = Math.hypot(tDx, tDy) || 1;
        this.ball.vx = (tDx / tLen) * KICK_SPEED;
        this.ball.vy = (tDy / tLen) * KICK_SPEED;
        p.kickCooldown = Phaser.Math.FloatBetween(0.5, 1.2);
      }

      let tx: number;
      let ty: number;
      let speed: number;

      if (p.pressing) {
        tx = this.ball.x;
        ty = this.ball.y;
        speed = PLAYER_SPEED;
      } else {
        const dir = p.team === 0 ? 1 : -1;

        switch (p.role) {
          case 'gk': {
            // Hold goal line, mirror ball vertically
            tx = this.FX + this.FW * p.homeX;
            ty = Phaser.Math.Clamp(
              this.ball.y,
              this.FY + this.FH * 0.3,
              this.FY + this.FH * 0.7
            );
            speed = PLAYER_SPEED * 0.65;
            break;
          }
          case 'cb': {
            // Hold defensive line, shift laterally toward ball but never past midfield
            const baseX = this.FX + this.FW * p.homeX;
            const pullX = (this.ball.x - baseX) * 0.18;
            const cbMin = p.team === 0 ? this.FX + this.FW * 0.06 : this.FX + this.FW * 0.44;
            const cbMax = p.team === 0 ? this.FX + this.FW * 0.44 : this.FX + this.FW * 0.94;
            tx = Phaser.Math.Clamp(baseX + pullX, cbMin, cbMax);
            ty = this.FY + this.FH * p.homeY + (ballFracY - 0.5) * this.FH * 0.12;
            speed = PLAYER_SPEED * 0.5;
            break;
          }
          case 'mf': {
            // Find space ahead of ball toward attack goal; two MFs spread in Y
            const supportX = this.ball.x + dir * Phaser.Math.Clamp(dist * 0.45, 70, 160);
            const mfMin = p.team === 0 ? this.FX + this.FW * 0.22 : this.FX + this.FW * 0.28;
            const mfMax = p.team === 0 ? this.FX + this.FW * 0.72 : this.FX + this.FW * 0.78;
            tx = Phaser.Math.Clamp(supportX, mfMin, mfMax);
            // Spread the two MFs above/below ball rather than stacking
            const spreadY = (p.homeY - 0.5) * this.FH * 0.55;
            ty = Phaser.Math.Clamp(
              this.ball.y + spreadY * 0.5,
              this.FY + this.FH * 0.12,
              this.FY + this.FH * 0.88
            );
            speed = PLAYER_SPEED * 0.55;
            break;
          }
          case 'st': {
            // Hang ahead of ball, make diagonal runs away from ball's Y position
            const runX = this.ball.x + dir * Phaser.Math.Clamp(dist * 0.55, 120, 240);
            const stMin = p.team === 0 ? this.FX + this.FW * 0.45 : this.FX + this.FW * 0.08;
            const stMax = p.team === 0 ? this.FX + this.FW * 0.92 : this.FX + this.FW * 0.55;
            tx = Phaser.Math.Clamp(runX, stMin, stMax);
            // Run to opposite Y side from ball to open space
            const runY = (this.FY + this.FH * 0.5) + (0.5 - ballFracY) * this.FH * 0.45;
            ty = Phaser.Math.Clamp(runY, this.FY + this.FH * 0.12, this.FY + this.FH * 0.88);
            speed = PLAYER_SPEED * 0.65;
            break;
          }
        }
      }

      const tdx = tx - p.x;
      const tdy = ty - p.y;
      const tdist = Math.hypot(tdx, tdy) || 1;
      const desiredVx = (tdx / tdist) * Math.min(tdist * 3, speed);
      const desiredVy = (tdy / tdist) * Math.min(tdist * 3, speed);

      // Separation push
      let sepX = 0;
      let sepY = 0;
      for (const other of this.players) {
        if (other === p) continue;
        const sdx = p.x - other.x;
        const sdy = p.y - other.y;
        const sd = Math.hypot(sdx, sdy) || 0.01;
        if (sd < SEP_DIST) {
          const push = (SEP_DIST - sd) / SEP_DIST;
          sepX += (sdx / sd) * push * 60;
          sepY += (sdy / sd) * push * 60;
        }
      }

      p.vx += (desiredVx + sepX - p.vx) * Math.min(dt * 5, 1);
      p.vy += (desiredVy + sepY - p.vy) * Math.min(dt * 5, 1);
      p.x += p.vx * dt;
      p.y += p.vy * dt;

      p.x = Phaser.Math.Clamp(p.x, this.FX + PLAYER_RADIUS, this.FX + this.FW - PLAYER_RADIUS);
      p.y = Phaser.Math.Clamp(p.y, this.FY + PLAYER_RADIUS, this.FY + this.FH - PLAYER_RADIUS);
    }
  }

  private drawBall() {
    const b = this.ball;
    const speed = Math.sqrt(b.vx ** 2 + b.vy ** 2);
    const trailAlpha = Math.min(speed / 200, 1);

    // Trail
    b.trail.clear();
    for (let i = 1; i < b.trailPoints.length; i++) {
      const t = i / b.trailPoints.length;
      const hue = (this.ledTime * 80 + i * 12) % 360;
      const col = this.hslToHex(hue, 100, 70);
      b.trail.fillStyle(col, t * trailAlpha * 0.7);
      const r = BALL_RADIUS * t * 0.8;
      b.trail.fillCircle(b.trailPoints[i].x, b.trailPoints[i].y, r);
    }

    // Glow
    b.glow.clear();
    const glowPulse = 1 + Math.sin(this.ledTime * 6) * 0.2;
    b.glow.fillStyle(0xffffff, 0.08);
    b.glow.fillCircle(b.x, b.y, BALL_RADIUS * 4 * glowPulse);
    b.glow.fillStyle(0xffffff, 0.12);
    b.glow.fillCircle(b.x, b.y, BALL_RADIUS * 2.5 * glowPulse);

    // Ball
    b.gfx.clear();
    b.gfx.fillStyle(BALL_COLOR, 1);
    b.gfx.fillCircle(b.x, b.y, BALL_RADIUS);
  }

  private drawPlayers() {
    const hue = (this.ledTime * 25) % 360;

    for (const p of this.players) {
      const baseColor = p.team === 0 ? TEAM_A_COLOR : TEAM_B_COLOR;
      const pulseColor = this.hslToHex(
        p.team === 0 ? (hue + 180) % 360 : hue,
        100, 65
      );
      const pulse = 1 + Math.sin(this.ledTime * 3 + p.x * 0.05) * 0.15;
      const speed = Math.sqrt(p.vx ** 2 + p.vy ** 2);
      const motionGlow = Math.min(speed / PLAYER_SPEED, 1);

      // Glow
      p.glow.clear();
      p.glow.fillStyle(pulseColor, 0.06 + motionGlow * 0.08);
      p.glow.fillCircle(p.x, p.y, PLAYER_RADIUS * 4 * pulse);
      p.glow.fillStyle(baseColor, 0.12 + motionGlow * 0.1);
      p.glow.fillCircle(p.x, p.y, PLAYER_RADIUS * 2.2 * pulse);

      // Body
      p.gfx.clear();
      p.gfx.fillStyle(baseColor, 1);
      p.gfx.fillCircle(p.x, p.y, PLAYER_RADIUS);

      // Direction dot
      const angle = Math.atan2(p.vy, p.vx);
      p.gfx.fillStyle(0x000000, 0.6);
      p.gfx.fillCircle(
        p.x + Math.cos(angle) * (PLAYER_RADIUS * 0.55),
        p.y + Math.sin(angle) * (PLAYER_RADIUS * 0.55),
        3
      );
    }
  }
}
