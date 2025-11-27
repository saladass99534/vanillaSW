

import React, { useState, useEffect, useRef } from 'react';
import SimplePeer from 'simple-peer';
import { Button } from './Button';
import { Chat, ChatHandle } from './Chat';
import { ChatMessage, generateRandomName, Member, ReplyContext, StreamStats, FloatingEmoji } from '../types';
import { Wifi, WifiOff, Tv, MessageSquare, Users, Crown, Clock, X, RefreshCw, Play, Pause, Volume2, VolumeX, Maximize, ArrowLeft, AlertCircle, Activity, Minimize, Sliders, PictureInPicture, Clapperboard } from 'lucide-react';

interface ViewerRoomProps {
  onBack: () => void;
}

// --- THEME CONFIG (Same as Host) ---
const THEMES: Record<string, { primary: string, glow: string, border: string, bg: string, accent: string }> = {
  default: { primary: 'text-blue-400', glow: 'shadow-blue-500/50', border: 'border-blue-500/30', bg: 'bg-blue-500', accent: 'accent-blue-500' },
  Action: { primary: 'text-yellow-400', glow: 'shadow-yellow-500/50', border: 'border-yellow-500/30', bg: 'bg-yellow-500', accent: 'accent-yellow-500' },
  'Sci-Fi': { primary: 'text-cyan-400', glow: 'shadow-cyan-500/50', border: 'border-cyan-500/30', bg: 'bg-cyan-500', accent: 'accent-cyan-500' },
  Horror: { primary: 'text-red-500', glow: 'shadow-red-600/50', border: 'border-red-600/30', bg: 'bg-red-600', accent: 'accent-red-600' },
  Comedy: { primary: 'text-orange-400', glow: 'shadow-orange-500/50', border: 'border-orange-500/30', bg: 'bg-orange-500', accent: 'accent-orange-500' },
  Romance: { primary: 'text-pink-400', glow: 'shadow-pink-500/50', border: 'border-pink-500/30', bg: 'bg-pink-500', accent: 'accent-pink-500' },
  Anime: { primary: 'text-purple-400', glow: 'shadow-purple-500/50', border: 'border-purple-500/30', bg: 'bg-purple-500', accent: 'accent-purple-500' },
  Thriller: { primary: 'text-emerald-400', glow: 'shadow-emerald-500/50', border: 'border-emerald-500/30', bg: 'bg-emerald-500', accent: 'accent-emerald-500' },
};

// Helper function to modify SDP for strict bitrate control (copied from HostRoom)
const setVideoBitrate = (sdp: string, bitrate: number): string => {
    if (bitrate <= 0) return sdp;

    let sdpLines = sdp.split('\r\n');
    let videoMLineIndex = -1;

    for (let i = 0; i < sdpLines.length; i++) {
        if (sdpLines[i].startsWith('m=video')) {
            videoMLineIndex = i;
            break;
        }
    }

    if (videoMLineIndex === -1) {
        return sdp;
    }

    let newSdpLines = sdpLines.filter(line => !line.startsWith('b=AS:'));
    newSdpLines.splice(videoMLineIndex + 1, 0, `b=AS:${bitrate}`);
    
    let codecPayloadType = -1;
    const codecRegex = /a=rtpmap:(\d+) (VP9|H264)\/90000/;
    for (const line of newSdpLines) {
        const match = line.match(codecRegex);
        if (match) {
            codecPayloadType = parseInt(match[1], 10);
            if (line.includes('VP9')) break;
        }
    }
    
    if (codecPayloadType !== -1) {
        let fmtpLineIndex = -1;
        for (let i = 0; i < newSdpLines.length; i++) {
            if (newSdpLines[i].startsWith(`a=fmtp:${codecPayloadType}`)) {
                fmtpLineIndex = i;
                break;
            }
        }
        
        const bitrateParams = `x-google-min-bitrate=${bitrate};x-google-start-bitrate=${bitrate};x-google-max-bitrate=${bitrate}`;

        if (fmtpLineIndex !== -1) {
            const existingLine = newSdpLines[fmtpLineIndex];
            if (!existingLine.includes('x-google-min-bitrate')) {
                 newSdpLines[fmtpLineIndex] = `${existingLine}; ${bitrateParams}`;
            }
        } else {
            let rtpmapLineIndex = newSdpLines.findIndex(line => line.startsWith(`a=rtpmap:${codecPayloadType}`));
            if(rtpmapLineIndex !== -1) {
                newSdpLines.splice(rtpmapLineIndex + 1, 0, `a=fmtp:${codecPayloadType} ${bitrateParams}`);
            }
        }
    }
    
    return newSdpLines.join('\r\n');
};

export const ViewerRoom: React.FC<ViewerRoomProps> = ({ onBack }) => {
  const [username] = useState(generateRandomName());
  const [myUserId] = useState(() => 'user-' + Date.now() + Math.random().toString(36).substr(2, 5));
  const [currentTheme, setCurrentTheme] = useState<keyof typeof THEMES>('default');
  
  const [hostIpInput, setHostIpInput] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  
  const [activeTab, setActiveTab] = useState<'chat' | 'members'>('chat');
  const [hasStream, setHasStream] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isTheaterMode, setIsTheaterMode] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [isInputFocused, setIsInputFocused] = useState(false); 
  const [isInputIdle, setIsInputIdle] = useState(false); 
  const [showExitConfirm, setShowExitConfirm] = useState(false);
  const [showNerdStats, setShowNerdStats] = useState(false); 
  const [pickerStep, setPickerStep] = useState<'idle' | 'type' | 'genre' | 'reveal'>('idle');
  
  // Mobile Detection & Viewport
  const [isMobile, setIsMobile] = useState(false);
  const [viewportHeight, setViewportHeight] = useState(typeof window !== 'undefined' ? window.innerHeight : 0);

  // Audio State
  const [volume, setVolume] = useState(1); // Default to 100%
  const prevVolumeRef = useRef(1);
  
  const [stats, setStats] = useState<StreamStats>({ resolution: 'N/A', bitrate: '0', fps: 0, packetLoss: '0', latency: '0' });
  
  const [floatingEmojis, setFloatingEmojis] = useState<FloatingEmoji[]>([]);

  const peerRef = useRef<SimplePeer.Instance | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const ambilightRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const controlsTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const statsIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const chatRef = useRef<ChatHandle>(null);
  const inputIdleTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const enforcedBitrateRef = useRef<number>(0);
  const lastStatsRef = useRef<{ timestamp: number; bytesReceived: number } | null>(null);

  const electronAvailable = typeof window !== 'undefined' && window.electron !== undefined;
  const activeTheme = THEMES[currentTheme] || THEMES['default'];

  // Handle Mobile Viewport Resize (Keyboard detection)
  useEffect(() => {
      const handleResize = () => {
          const isMob = window.innerWidth < 768;
          setIsMobile(isMob);
          // Use visualViewport if available to account for virtual keyboard
          if (window.visualViewport) {
              setViewportHeight(window.visualViewport.height);
          } else {
              setViewportHeight(window.innerHeight);
          }
      };

      handleResize();
      
      window.addEventListener('resize', handleResize);
      window.visualViewport?.addEventListener('resize', handleResize);
      
      return () => {
          window.removeEventListener('resize', handleResize);
          window.visualViewport?.removeEventListener('resize', handleResize);
      };
  }, []);

  useEffect(() => {
      if (!electronAvailable) {
          const hostname = window.location.hostname;
          if (hostname && hostname !== 'localhost' && hostname !== '127.0.0.1') {
              setHostIpInput(hostname);
          }
      }
  }, [electronAvailable]);

  // Audio Volume Logic
  const toggleMute = () => {
      if (volume > 0) {
          prevVolumeRef.current = volume;
          setVolume(0);
      } else {
          setVolume(prevVolumeRef.current > 0 ? prevVolumeRef.current : 0.5);
      }
  };

  // Sync volume with video element
  useEffect(() => {
      if (videoRef.current) {
          videoRef.current.volume = volume;
          videoRef.current.muted = (volume === 0);
      }
  }, [volume]);

  const connectToHost = () => {
      if (!hostIpInput) return;
      setIsConnecting(true);

      if (electronAvailable) {
          window.electron.connectToHost(hostIpInput, 65432);
      } else {
          connectWebMode(hostIpInput, 65432);
      }
  };

  const connectWebMode = (ip: string, port: number) => {
      try {
          const ws = new WebSocket(`ws://${ip}:${port}`);
          socketRef.current = ws;

          ws.onopen = () => {
              setIsConnected(true);
          };

          ws.onmessage = (event) => {
              try {
                  const parsed = JSON.parse(event.data);
                  handleSignal(parsed);
              } catch (e) {
                  console.error("Web socket parse error", e);
              }
          };

          ws.onerror = (err) => {
              console.error("WebSocket error", err);
              alert("Connection failed. Ensure Host is online and Tailscale is active.");
              setIsConnecting(false);
              setIsConnected(false);
          };

          ws.onclose = () => {
              alert("Disconnected from Host");
              setIsConnected(false);
              setHasStream(false);
              if (peerRef.current) peerRef.current.destroy();
              peerRef.current = null;
          };

      } catch (e) {
          alert("Failed to create WebSocket: " + e);
          setIsConnecting(false);
      }
  };

  const handleSignal = (payload: any) => {
        if (payload.type === 'signal') {
            if (!peerRef.current) {
                const p = new SimplePeer({
                    initiator: false,
                    trickle: false
                });

                p.on('signal', (data) => {
                    if (data.type === 'answer' && enforcedBitrateRef.current > 0) {
                        data.sdp = setVideoBitrate(data.sdp!, enforcedBitrateRef.current);
                    }
                    const signalPayload = { type: 'signal', data };
                    if (electronAvailable) {
                        window.electron.guestSendSignal(signalPayload);
                    } else if (socketRef.current?.readyState === WebSocket.OPEN) {
                        socketRef.current.send(JSON.stringify(signalPayload));
                    }
                });

                p.on('connect', () => {
                    setIsConnecting(false);
                    const joinMsg = JSON.stringify({ type: 'join', name: username });
                    p.send(joinMsg);
                });

                p.on('stream', (stream) => {
                    if (videoRef.current) {
                        videoRef.current.srcObject = stream;
                        videoRef.current.volume = volume; // Ensure initial volume is set
                        videoRef.current.play().then(() => setIsPlaying(true)).catch(e => console.log("Autoplay blocked", e));
                        setHasStream(true);
                    }
                    if (ambilightRef.current) {
                        ambilightRef.current.srcObject = stream;
                        ambilightRef.current.play().catch(() => {});
                    }
                });

                p.on('data', (data) => {
                    try {
                        const msg = JSON.parse(data.toString());
                        if (msg.type === 'chat') {
                            const newMsg = msg.payload;
                            if (newMsg.isSystemEvent && newMsg.eventPayload) {
                                setPickerStep(newMsg.eventPayload.state);
                            }
                            setMessages(prev => {
                                if (prev.some(m => m.id === newMsg.id)) return prev;
                                return [...prev, newMsg];
                            });
                        }
                        if (msg.type === 'members') setMembers(msg.payload);
                        
                        if (msg.type === 'hype') {
                            spawnHypeEmojis(msg.payload.emoji); // Spawn locally only
                        }

                        if (msg.type === 'theme_change') {
                            setCurrentTheme(msg.payload);
                        }

                        if (msg.type === 'bitrate_sync') {
                            enforcedBitrateRef.current = msg.payload;
                        }

                        if (msg.type === 'stream_stopped') {
                            setHasStream(false);
                            setIsPlaying(false);
                            if (videoRef.current) videoRef.current.srcObject = null;
                            if (ambilightRef.current) ambilightRef.current.srcObject = null;
                            lastStatsRef.current = null;
                        }
                    } catch (e) { console.error("Parse error", e); }
                });
                
                peerRef.current = p;
            }
            
            peerRef.current.signal(payload.data);
        }
  };

  const spawnHypeEmojis = (emoji: string) => {
      const newEmojis = Array.from({ length: 20 }).map((_, i) => ({
          id: Math.random().toString(36) + i,
          emoji,
          x: Math.random() * 90 + 5,
          animationDuration: 3 + Math.random() * 4
      }));

      setFloatingEmojis(prev => [...prev, ...newEmojis]);
      
      setTimeout(() => {
          setFloatingEmojis(prev => prev.filter(e => !newEmojis.some(ne => ne.id === e.id)));
      }, 8000);
  };

  useEffect(() => {
      if (hasStream && showNerdStats && peerRef.current) {
          statsIntervalRef.current = setInterval(() => {
              const peer = peerRef.current as any;
              if (peer && peer._pc) {
                  peer._pc.getStats().then((reports: any) => {
                      reports.forEach((report: any) => {
                          if (report.type === 'inbound-rtp' && report.kind === 'video') {
                              if (videoRef.current) {
                                  if (lastStatsRef.current) {
                                      const bytesSinceLast = report.bytesReceived - lastStatsRef.current.bytesReceived;
                                      const timeSinceLast = report.timestamp - lastStatsRef.current.timestamp;
                                      if (timeSinceLast > 0) {
                                          const bitrate = Math.round((bytesSinceLast * 8) / timeSinceLast); // kbps
                                          setStats(prev => ({ ...prev, bitrate: `${(bitrate / 1000).toFixed(1)} Mbps` }));
                                      }
                                  }
                                  lastStatsRef.current = {
                                      timestamp: report.timestamp,
                                      bytesReceived: report.bytesReceived,
                                  };

                                  setStats(prev => ({
                                      ...prev,
                                      resolution: `${videoRef.current?.videoWidth}x${videoRef.current?.videoHeight}`,
                                      fps: report.framesPerSecond || 0,
                                      packetLoss: report.packetsLost ? `${report.packetsLost}` : '0'
                                  }));
                              }
                          }
                          if (report.type === 'candidate-pair' && report.state === 'succeeded') {
                              setStats(prev => ({
                                  ...prev,
                                  latency: `${Math.round(report.currentRoundTripTime * 1000)} ms`,
                              }));
                          }
                      });
                  });
              }
          }, 1000);
      } else {
          if (statsIntervalRef.current) clearInterval(statsIntervalRef.current);
          lastStatsRef.current = null;
      }
      return () => {
          if (statsIntervalRef.current) clearInterval(statsIntervalRef.current);
      };
  }, [hasStream, showNerdStats]);

  const toggleFullscreen = () => {
    const elem = containerRef.current;
    const videoElem = videoRef.current as any;

    if (!document.fullscreenElement && !((document as any).webkitFullscreenElement)) {
        if (elem?.requestFullscreen) {
            elem.requestFullscreen().catch(err => {
               if (videoElem && videoElem.webkitEnterFullscreen) {
                   videoElem.webkitEnterFullscreen();
               }
            });
        } 
        else if (videoElem && videoElem.webkitEnterFullscreen) {
            videoElem.webkitEnterFullscreen();
        }
    } else {
        if (document.exitFullscreen) {
            document.exitFullscreen();
        } else if ((document as any).webkitExitFullscreen) {
            (document as any).webkitExitFullscreen();
        }
    }
  };

  const togglePiP = async () => {
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else if (videoRef.current && videoRef.current !== document.pictureInPictureElement) {
        await videoRef.current.requestPictureInPicture();
      }
    } catch (err) {
      console.error("PiP failed", err);
    }
  };

  const togglePlay = () => {
      if (videoRef.current) {
          if (videoRef.current.paused) {
              videoRef.current.play().catch(console.error);
          } else {
              videoRef.current.pause();
          }
      }
  };

  useEffect(() => {
    const handleFsChange = () => {
        const isFs = !!document.fullscreenElement || !!(document as any).webkitFullscreenElement;
        setIsFullscreen(isFs);
        if (!isFs) {
            setIsTheaterMode(false);
        }
    };
    
    const handleWebkitEnd = () => {
        setIsFullscreen(false);
        setIsTheaterMode(false);
        if (videoRef.current && !videoRef.current.ended) {
            videoRef.current.play().catch(e => console.log("Resume failed:", e));
        }
    };
    const handleWebkitBegin = () => setIsFullscreen(true);

    document.addEventListener('fullscreenchange', handleFsChange);
    document.addEventListener('webkitfullscreenchange', handleFsChange);
    
    const videoEl = videoRef.current;
    if (videoEl) {
        videoEl.addEventListener('webkitendfullscreen', handleWebkitEnd);
        videoEl.addEventListener('webkitbeginfullscreen', handleWebkitBegin);
    }

    return () => {
        document.removeEventListener('fullscreenchange', handleFsChange);
        document.removeEventListener('webkitfullscreenchange', handleFsChange);
        if (videoEl) {
            videoEl.removeEventListener('webkitendfullscreen', handleWebkitEnd);
            videoEl.removeEventListener('webkitbeginfullscreen', handleWebkitBegin);
        }
    };
  }, [hasStream]);

  const resetInputIdleTimer = () => {
      setIsInputIdle(false);
      if (inputIdleTimeoutRef.current) clearTimeout(inputIdleTimeoutRef.current);
      if (isInputFocused) {
          inputIdleTimeoutRef.current = setTimeout(() => {
              setIsInputIdle(true);
          }, 4000);
      }
  };

  useEffect(() => {
      resetInputIdleTimer();
  }, [isInputFocused]);

  // Escape key for Theater Mode
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isTheaterMode) {
        setIsTheaterMode(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isTheaterMode]);

  // Auto-wake chat
  useEffect(() => {
      const handleGlobalKeyDown = (e: KeyboardEvent) => {
          resetInputIdleTimer();
          if ((isTheaterMode || isFullscreen) && !isInputFocused) {
              if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
                  setShowControls(true);
                  chatRef.current?.focusInput();
              }
          }
      };
      window.addEventListener('keydown', handleGlobalKeyDown);
      return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [isTheaterMode, isFullscreen, isInputFocused]);

  useEffect(() => {
      if (!electronAvailable) return;

      window.electron.onGuestConnected(() => {
          setIsConnected(true);
      });

      window.electron.onGuestSignalReceived((payload) => {
          handleSignal(payload);
      });

      window.electron.onGuestError((err) => {
          alert("Connection Error: " + err);
          setIsConnecting(false);
          setIsConnected(false);
      });

      window.electron.onGuestDisconnected(() => {
          alert("Disconnected from Host");
          setIsConnected(false);
          setHasStream(false);
          if (peerRef.current) peerRef.current.destroy();
          peerRef.current = null;
      });

      return () => {
          window.electron.removeAllListeners('guest-connected');
          window.electron.removeAllListeners('guest-signal-received');
          window.electron.removeAllListeners('guest-error');
          window.electron.removeAllListeners('guest-disconnected');
          if (peerRef.current) peerRef.current.destroy();
      };
  }, [username, electronAvailable]);

  const handleSendMessage = (text: string, type: 'text' | 'gif' = 'text') => {
      if (peerRef.current?.connected) {
          const msg = { 
            id: Date.now().toString(), 
            senderId: myUserId, 
            senderName: username, 
            text, 
            timestamp: Date.now(),
            type 
          };
          setMessages(prev => {
              if (prev.some(m => m.id === msg.id)) return prev;
              return [...prev, msg];
          });
          peerRef.current.send(JSON.stringify({ type: 'chat', payload: msg }));
      }
  };

  const handleSendHype = (emoji: string) => {
      spawnHypeEmojis(emoji); 
      if (peerRef.current?.connected) {
          peerRef.current.send(JSON.stringify({ type: 'hype', payload: { emoji } }));
      }
  };

  const handlePickerAction = (action: string, value?: string) => {
      if (peerRef.current?.connected) {
          peerRef.current.send(JSON.stringify({ 
              type: 'picker_action', 
              payload: { action, value } 
          }));
      }
  };

  if (!isConnected && !hasStream) {
     return (
       <div className="min-h-screen bg-black flex flex-col items-center justify-center p-4 relative">
         <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-20 mix-blend-overlay"></div>
         <button onClick={onBack} className="absolute top-8 left-8 text-gray-400 hover:text-white flex items-center gap-2 z-20"><ArrowLeft size={16} /> Back</button>
         <div className="relative z-10 max-w-md w-full bg-white/5 backdrop-blur-xl rounded-3xl p-8 border border-white/10 shadow-2xl">
           <div className="flex justify-center mb-6"><div className="bg-purple-500/20 p-4 rounded-2xl"><Users className="text-purple-400 w-8 h-8" /></div></div>
           <h2 className="text-3xl font-bold text-center text-white mb-2">Join Party</h2>
           <p className="text-gray-400 text-center mb-8 text-sm">
               {electronAvailable ? "Enter Host IP Address" : "Connect to Host"}
           </p>
           <div className="space-y-6">
             <div>
                <label className="text-xs font-bold text-gray-500 uppercase block mb-1">Host IP Address</label>
                <input type="text" value={hostIpInput} onChange={(e) => setHostIpInput(e.target.value)} placeholder="100.x.x.x" className="w-full bg-black/30 border border-white/10 rounded-xl px-4 py-4 text-white focus:outline-none focus:ring-2 focus:ring-purple-500/50" />
             </div>
             <Button className="w-full py-4" size="lg" onClick={connectToHost} isLoading={isConnecting} disabled={!hostIpInput}>{isConnecting ? 'CONNECTING...' : 'JOIN'}</Button>
             {!electronAvailable && <p className="text-blue-400 text-xs text-center mt-2">Running in Web Mode</p>}
           </div>
         </div>
       </div>
     );
  }

  // Mobile typing logic
  const mobileTypingMode = isMobile && isInputFocused;
  const controlsVisible = (showControls || (isInputFocused && !isInputIdle)) && !mobileTypingMode;
  const sidebarCollapsed = isTheaterMode || isFullscreen;

  // Dynamic height style for mobile viewport responsiveness
  const containerStyle = isMobile ? { height: `${viewportHeight}px` } : {};

  return (
    <div style={containerStyle} className="flex flex-col md:flex-row h-[100dvh] bg-[#313338] text-gray-100 overflow-hidden font-sans relative transition-colors duration-500">
      
       {showExitConfirm && (
        <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
            <div className="bg-[#1e1f22] border border-white/10 rounded-2xl p-6 max-w-sm w-full shadow-2xl scale-100 animate-in zoom-in-95 duration-200">
                <div className="flex items-center gap-3 mb-4 text-gray-200">
                    <AlertCircle size={24} />
                    <h3 className="text-lg font-bold">Leave Party?</h3>
                </div>
                <p className="text-gray-400 text-sm mb-6">
                    You will be disconnected from the stream.
                </p>
                <div className="flex gap-3 justify-end">
                    <Button variant="ghost" onClick={() => setShowExitConfirm(false)}>Cancel</Button>
                    <Button variant="danger" onClick={onBack}>Leave</Button>
                </div>
            </div>
        </div>
      )}

      {/* Video Area - In mobile typing mode, it becomes the background */}
      <div className={`flex flex-col relative bg-black min-w-0 transition-all duration-500 ease-in-out ${sidebarCollapsed || mobileTypingMode ? 'w-full h-full' : 'w-full h-[35vh] min-h-[250px] md:h-full md:flex-1'} ${mobileTypingMode ? 'absolute inset-0 z-0' : 'sticky top-0 z-30 md:static'}`}>
        
        {/* Top Bar */}
        <div className={`absolute top-0 left-0 right-0 z-20 p-4 flex justify-between pointer-events-none transition-opacity duration-300 ${controlsVisible ? 'opacity-100' : 'opacity-0'}`}>
            <Button variant="secondary" size="sm" onClick={() => setShowExitConfirm(true)} className="pointer-events-auto bg-white/10 backdrop-blur hover:bg-red-500/20 hover:text-red-200 transition-colors">Leave</Button>
        </div>

        <div 
            ref={containerRef}
            className="flex-1 flex items-center justify-center relative bg-black group"
            onMouseMove={() => {
                setShowControls(true);
                resetInputIdleTimer();
                if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
                controlsTimeoutRef.current = setTimeout(() => setShowControls(false), 2500);
            }}
            onClick={() => {
                if (!electronAvailable && !mobileTypingMode) {
                    setShowControls(!showControls);
                }
            }}
        >
          {/* FLOATING EMOJIS */}
          <div className="absolute inset-0 overflow-hidden pointer-events-none z-40">
                  {floatingEmojis.map(emoji => (
                      <div 
                          key={emoji.id}
                          className="absolute bottom-0 text-6xl animate-float"
                          style={{
                              left: `${emoji.x}%`,
                              animationDuration: `${emoji.animationDuration}s`,
                              filter: 'drop-shadow(0 4px 6px rgba(0,0,0,0.3))',
                              transform: 'perspective(500px) rotateX(10deg)'
                          }}
                      >
                          {emoji.emoji}
                      </div>
                  ))}
                  <style>{`
                      @keyframes float {
                          0% { transform: translateY(100%) perspective(500px) rotateX(10deg) scale(0.8); opacity: 0; }
                          10% { opacity: 1; transform: translateY(80%) perspective(500px) rotateX(10deg) scale(1.2); }
                          100% { transform: translateY(-150%) perspective(500px) rotateX(10deg) scale(1); opacity: 0; }
                      }
                      .animate-float { animation-name: float; animation-timing-function: ease-out; }
                  `}</style>
            </div>
          {!hasStream && (
            <div className="text-center animate-pulse">
                <Tv size={48} className="mx-auto text-gray-700 mb-4" />
                <p className="text-gray-500">Waiting for stream...</p>
            </div>
          )}

          {/* AMBILIGHT LAYER */}
          <video 
              ref={ambilightRef}
              className="absolute inset-0 w-full h-full object-cover blur-[80px] opacity-60 pointer-events-none"
              muted
          />

          {showNerdStats && (
                <div className="absolute top-16 left-4 bg-black/60 backdrop-blur-md border border-white/10 p-3 rounded-lg z-30 text-[10px] font-mono text-gray-300 pointer-events-none select-none animate-in slide-in-from-left-2">
                    <h4 className={`${activeTheme.primary} font-bold mb-1 flex items-center gap-1`}><Activity size={10}/> STREAM STATS (RECV)</h4>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                        <span>Resolution:</span> <span className="text-white">{stats.resolution}</span>
                        <span>FPS:</span> <span className="text-white">{Math.round(stats.fps)}</span>
                        <span>Bitrate:</span> <span className="text-green-400">{stats.bitrate}</span>
                        <span>Latency:</span> <span className="text-yellow-400">{stats.latency}</span>
                        <span>Packet Loss:</span> <span className="text-red-400">{stats.packetLoss}</span>
                    </div>
                </div>
          )}

          {/* BIG PLAY BUTTON OVERLAY (If paused) */}
          {hasStream && !isPlaying && (
              <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-[2px] transition-opacity duration-300">
                  <button 
                    onClick={togglePlay}
                    className="bg-white/20 hover:bg-white/30 rounded-full p-6 backdrop-blur-md border border-white/20 transition-transform hover:scale-110 group/play"
                  >
                      <Play size={48} className="text-white fill-white ml-2 opacity-90 group-hover/play:opacity-100" />
                  </button>
              </div>
          )}

          <video 
            ref={videoRef} 
            className={`relative z-10 w-full h-full object-contain ${!hasStream ? 'hidden' : ''}`} 
            autoPlay 
            playsInline 
            onPlay={() => setIsPlaying(true)}
            onPause={() => setIsPlaying(false)}
          />

          {(isTheaterMode || isFullscreen) && (
               <div className={`absolute bottom-32 left-4 w-[400px] max-w-[80vw] z-[60] flex flex-col justify-end transition-opacity duration-300`}>
                  <Chat 
                    ref={chatRef}
                    messages={messages} 
                    onSendMessage={handleSendMessage} 
                    onAddReaction={() => {}}
                    onHypeEmoji={handleSendHype}
                    onPickerAction={handlePickerAction} 
                    myId={myUserId} 
                    isOverlay={true} 
                    inputVisible={controlsVisible} 
                    onInputFocus={() => setIsInputFocused(true)}
                    onInputBlur={() => setIsInputFocused(false)}
                    onInputChange={resetInputIdleTimer}
                    theme={activeTheme}
                  />
              </div>
          )}

          {/* GLASS HUD */}
          <div className={`absolute bottom-8 left-1/2 -translate-x-1/2 z-50 transition-all duration-500 ${controlsVisible ? 'translate-y-0 opacity-100' : 'translate-y-8 opacity-0 pointer-events-none'}`}>
             <div className="flex items-center gap-4 px-6 py-3 rounded-full bg-black/40 backdrop-blur-xl border border-white/10 shadow-2xl hover:bg-black/50 hover:scale-[1.02] transition-all">
                 
                 {/* Play/Pause */}
                 <button onClick={togglePlay} className="p-2 hover:bg-white/10 rounded-full text-gray-300 hover:text-white active:scale-95">
                     {isPlaying ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}
                 </button>

                 {/* Volume */}
                 <div className="flex items-center gap-2 group/vol">
                    <button onClick={toggleMute} className="p-2 hover:bg-white/10 rounded-full transition-colors active:scale-95">
                        {volume === 0 ? <VolumeX size={20} className="text-red-400" /> : <Volume2 size={20} className="text-gray-300 group-hover/vol:text-white" />}
                    </button>
                    <div className="w-20 md:w-0 overflow-hidden md:group-hover/vol:w-24 transition-all duration-300 flex items-center">
                        <input 
                            type="range" min="0" max="1" step="0.05" 
                            value={volume} onChange={(e) => setVolume(parseFloat(e.target.value))}
                            className={`w-full h-1.5 rounded-lg appearance-none cursor-pointer transition-colors bg-white/20 hover:bg-white/30 ${activeTheme.accent}`}
                        />
                    </div>
                 </div>

                 <div className="w-px h-6 bg-white/10"></div>

                 <div className="flex gap-2 items-center">
                    <button 
                        onClick={() => handlePickerAction('start_picker')} 
                        disabled={(pickerStep !== 'idle' && pickerStep !== 'reveal')}
                        className={`p-2 hover:bg-white/10 rounded-full transition-colors active:scale-95 ${(pickerStep !== 'idle' && pickerStep !== 'reveal') ? 'text-gray-600 cursor-not-allowed' : `${activeTheme.primary}`}`}
                        title="Suggest Movie"
                    >
                        <Clapperboard size={18} />
                    </button>
                     <button onClick={() => setShowNerdStats(!showNerdStats)} className={`p-2 hover:bg-white/10 rounded-full transition-colors active:scale-95 ${showNerdStats ? `${activeTheme.primary}` : 'text-gray-400 hover:text-white'}`} title="Nerd Stats">
                         <Activity size={18} />
                     </button>
                     <button onClick={togglePiP} className="p-2 hover:bg-white/10 rounded-full text-gray-400 hover:text-white active:scale-95" title="Picture-in-Picture">
                         <PictureInPicture size={18} />
                     </button>
                     <button onClick={() => setIsTheaterMode(!isTheaterMode)} className={`p-2 hover:bg-white/10 rounded-full transition-colors active:scale-95 ${isTheaterMode ? `${activeTheme.primary}` : 'text-gray-400 hover:text-white'}`} title="Toggle Theater Mode">
                         <Tv size={18} />
                     </button>
                     <button onClick={toggleFullscreen} className="p-2 hover:bg-white/10 rounded-full text-gray-400 hover:text-white active:scale-95" title="Fullscreen">
                         {isFullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
                     </button>
                 </div>
             </div>
          </div>
        </div>
      </div>

      {/* CHAT/SIDEBAR - Switches to Overlay on Mobile Typing */}
      <div className={`
          flex flex-col flex-1 md:flex-none min-h-0 min-w-0 transition-all duration-500 ease-in-out rounded-3xl shadow-2xl overflow-hidden
          ${mobileTypingMode 
              ? 'absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/90 via-black/40 to-transparent m-0 border-none rounded-none pointer-events-none justify-end h-2/3' 
              : `bg-black/40 backdrop-blur-xl border ${activeTheme.border} ${activeTheme.glow} w-auto md:w-80 mx-4 mb-4 md:m-4`
          }
          ${sidebarCollapsed ? 'max-w-0 md:max-w-0 opacity-0 m-0 border-0 pointer-events-none' : 'w-full opacity-100'}
      `}>
           <div className={`min-w-[320px] h-full flex flex-col transition-transform duration-500 ease-in-out ${sidebarCollapsed ? 'translate-x-full' : 'translate-x-0'}`}>
                {/* Hide tabs when mobile typing to save space */}
               <div className={`flex p-2 gap-2 ${mobileTypingMode ? 'hidden' : ''}`}>
                   <button onClick={() => setActiveTab('chat')} className={`flex-1 py-2 text-xs font-bold rounded-full transition-all ${activeTab === 'chat' ? `bg-white/10 text-white` : 'text-gray-400 hover:text-white hover:bg-white/5'}`}>CHAT</button>
                   <button onClick={() => setActiveTab('members')} className={`flex-1 py-2 text-xs font-bold rounded-full transition-all ${activeTab === 'members' ? `bg-white/10 text-white` : 'text-gray-400 hover:text-white hover:bg-white/5'}`}>MEMBERS</button>
               </div>
               <div className={`flex-1 relative ${mobileTypingMode ? 'pointer-events-auto' : ''}`}>
                   {activeTab === 'chat' && <div className="absolute inset-0 flex flex-col"><Chat messages={messages} onSendMessage={handleSendMessage} onAddReaction={() => {}} onHypeEmoji={handleSendHype} onPickerAction={handlePickerAction} myId={myUserId} theme={activeTheme} onInputFocus={() => setIsInputFocused(true)} onInputBlur={() => setIsInputFocused(false)} onInputChange={resetInputIdleTimer} /></div>}
                   {activeTab === 'members' && (
                       <div className="p-4 space-y-2">
                           {members.map(m => (
                               <div key={m.id} className="flex items-center justify-between p-3 bg-white/5 rounded-xl border border-white/5 hover:bg-white/10 transition-colors">
                                   <div className="flex items-center gap-3">
                                       <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${m.isHost ? `bg-gradient-to-br from-yellow-400 to-orange-500 text-black` : 'bg-white/10 text-white'}`}>
                                           {m.name[0]}
                                       </div>
                                       <span className="text-sm font-medium text-gray-200">{m.name}</span>
                                   </div>
                                   {m.isHost && <Crown size={14} className="text-yellow-500 drop-shadow-md" />}
                               </div>
                           ))}
                       </div>
                   )}
               </div>
           </div>
      </div>
    </div>
  );
};
