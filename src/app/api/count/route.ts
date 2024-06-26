import {NextRequest, NextResponse} from "next/server";
import * as jose from "jose";
import {randomUUID} from "crypto";

interface State {
  count: number;
  incs: number;
  decs: number;
  clicks: number;
}

type Action = "inc" | "dec";

const HOST = process.env["HOST"] ?? "https://stateful-counter-frame.vercel.app";
const JWS_SECRET = process.env["JWS_SECRET"] ?? "";

async function encodeState(state: State) {
  return await new jose.CompactSign(
    new TextEncoder().encode(JSON.stringify({...state, nonce: randomUUID()}))
  )
    .setProtectedHeader({alg: "HS256"})
    .sign(Buffer.from(JWS_SECRET, "hex"));
}

async function verifyState(encodedState: string): Promise<State> {
  const {payload} = await jose.compactVerify(
    encodedState,
    Buffer.from(JWS_SECRET, "hex")
  );
  const {nonce, ...state} = JSON.parse(new TextDecoder().decode(payload));
  return state;
}

function deriveState(state: State, action: Action) {
  if (action === "inc") {
    state.count++;
    state.incs++;
  }
  if (action === "dec" && state.count > 0) {
    state.count--;
    state.decs++;
  }
  state.clicks++;
  return state;
}

export async function POST(req: NextRequest) {
  const {
    untrustedData: {buttonIndex, state: serializedState},
  } = await req.json();
  console.log("serializedState", serializedState);
  console.log("buttonIndex", buttonIndex);
  let state: State;
  if (!serializedState) {
    console.log("No state");
    state = {
      count: 0,
      incs: 0,
      decs: 0,
      clicks: 0,
    };
  } else {
    try {
      console.log("serializedState", serializedState);
      state = await verifyState(serializedState);
    } catch (e: any) {
      console.error(e);
      if (e?.code === "ERR_JWS_INVALID") {
        return new NextResponse("Invalid state", {status: 400});
      } else {
        return new NextResponse("Internal server error", {status: 500});
      }
    }
  }

  let action: Action;
  if (state.count === 0) {
    action = "inc";
  } else {
    action = buttonIndex === 1 ? "dec" : "inc";
  }

  const newState = deriveState(state, action);
  const encodedState = await encodeState(newState);

  const postUrl = `${HOST}/api/count`;
  const imageUrl = `${HOST}/api/images/count?state=${encodeURIComponent(JSON.stringify(newState))}`;

  const buttons =
    state.count > 0
      ? [
          '<meta name="fc:frame:button:1" content="-" />',
          '<meta name="fc:frame:button:2" content="+" />',
        ]
      : ['<meta name="fc:frame:button:1" content="+" />'];

  return new NextResponse(
    `<!DOCTYPE html>
      <html>
        <head>
          <meta property="og:title" content="Stateful Counter" />
          <meta property="og:image" content="${imageUrl}" />
          <meta name="fc:frame" content="vNext" />
          <meta name="fc:frame:image" content="${imageUrl}" />
          <meta name="fc:frame:post_url" content="${postUrl}" />
          <meta name="fc:frame:state" content="${encodedState}" />
          ${buttons.join("\n")}
        </head>
        <body></body>
      </html>`,
    {
      status: 200,
      headers: {
        "Content-Type": "text/html",
      },
    }
  );
}

export const GET = POST;
