

import React, { useState, useEffect, useRef } from 'react';
import SimplePeer from 'simple-peer';
import { 
  Users, Copy, Check, Tv, Maximize, Minimize, Volume2, VolumeX,
  ScreenShare, ScreenShareOff, Power, Crown, X, Smile, Image as ImageIcon, ArrowLeft, Zap, Send,
  Monitor, AppWindow, Settings, AlertTriangle, AlertCircle, Wifi, Mic, HelpCircle, Activity, RefreshCw, Globe, Sliders, Camera, RotateCcw, Clapperboard, Film, Star, Terminal, PictureInPicture
} from 'lucide-react';
import { Button } from './Button';
import { Chat, EMOJIS, ChatHandle } from './Chat';
import { ChatMessage, generateRandomName, Member, ReplyContext, DesktopSource, StreamStats, FloatingEmoji } from '../types';
import { MOVIE_DB, SHOW_DB, GENRES, Genre, MovieOption, MediaType } from '../movieData';

interface HostRoomProps {
  onBack: () => void;
}

type SidebarTab = 'chat' | 'members';

// --- THEME CONFIG ---
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

// Helper function to modify SDP for strict bitrate control
const setVideoBitrate = (sdp: string, bitrate: number): string => {
    if (bitrate <= 0) return sdp; // Do nothing if bitrate is automatic

    let sdpLines = sdp.split('\r\n');
    let videoMLineIndex = -1;

    // Find the `m=video` line
    for (let i = 0; i < sdpLines.length; i++) {
        if (sdpLines[i].startsWith('m=video')) {
            videoMLineIndex = i;
            break;
        }
    }

    if (videoMLineIndex === -1) {
        console.warn('Could not find m=video line in SDP');
        return sdp;
    }

    // 1. General compatibility: b=AS (Application Specific)
    // Remove any existing b=AS lines to avoid duplicates
    let newSdpLines = sdpLines.filter(line => !line.startsWith('b=AS:'));
    // Add the new b=AS line right after the `m=video` line
    newSdpLines.splice(videoMLineIndex + 1, 0, `b=AS:${bitrate}`);
    
    // 2. Chrome-specific strict enforcement: x-google-*
    let codecPayloadType = -1;
    // Find a preferred codec payload type (VP9, H264, etc.)
    const codecRegex = /a=rtpmap:(\d+) (VP9|H264)\/90000/;
    for (const line of newSdpLines) {
        const match = line.match(codecRegex);
        if (match) {
            codecPayloadType = parseInt(match[1], 10);
            // Prefer VP9 if available, otherwise stick with the first one found
            if (line.includes('VP9')) {
                break;
            }
        }
    }
    
    if (codecPayloadType !== -1) {
        let fmtpLineIndex = -1;
        // Find the `a=fmtp` line for the found codec
        for (let i = 0; i < newSdpLines.length; i++) {
            if (newSdpLines[i].startsWith(`a=fmtp:${codecPayloadType}`)) {
                fmtpLineIndex = i;
                break;
            }
        }
        
        // These are in kbps for the SDP
        const bitrateParams = `x-google-min-bitrate=${bitrate};x-google-start-bitrate=${bitrate};x-google-max-bitrate=${bitrate}`;

        if (fmtpLineIndex !== -1) {
            // Append to existing fmtp line, ensuring no duplicate params
            const existingLine = newSdpLines[fmtpLineIndex];
            if (!existingLine.includes('x-google-min-bitrate')) {
                 newSdpLines[fmtpLineIndex] = `${existingLine}; ${bitrateParams}`;
            }
        } else {
            // Create a new fmtp line if it doesn't exist
            let rtpmapLineIndex = newSdpLines.findIndex(line => line.startsWith(`a=rtpmap:${codecPayloadType}`));
            if(rtpmapLineIndex !== -1) {
                newSdpLines.splice(rtpmapLineIndex + 1, 0, `a=fmtp:${codecPayloadType} ${bitrateParams}`);
            }
        }
    } else {
        console.warn('Could not find a supported video codec (VP9/H264) to apply strict bitrate settings.');
    }
    
    return newSdpLines.join('\r\n');
};

export const HostRoom: React.FC<HostRoomProps> = ({ onBack }) => {
  // Setup State
  const [isRoomStarted, setIsRoomStarted] = useState(false);
  const [myIp, setMyIp] = useState('');
  const [isInitializing, setIsInitializing] = useState(false);
  const [isWebStreamEnabled, setIsWebStreamEnabled] = useState(true);

  // App State
  const [username] = useState(generateRandomName());
  const [currentTheme, setCurrentTheme] = useState<keyof typeof THEMES>('default');
  
  // UI State
  const [activeTab, setActiveTab] = useState<SidebarTab>('chat');
  const [showControls, setShowControls] = useState(true);
  const [isInputFocused, setIsInputFocused] = useState(false);
  const [isInputIdle, setIsInputIdle] = useState(false); // New state for idle typing
  const [isTheaterMode, setIsTheaterMode] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showExitConfirm, setShowExitConfirm] = useState(false);
  const [showVideoSettings, setShowVideoSettings] = useState(false);
  const [showNerdStats, setShowNerdStats] = useState(false);
  
  // Movie Suggester Logic
  const [seenTitles, setSeenTitles] = useState<Set<string>>(new Set());
  const [activeMediaType, setActiveMediaType] = useState<MediaType>('Movie');
  const [pickerStep, setPickerStep] = useState<'idle' | 'type' | 'genre' | 'reveal'>('idle');

  // State Refs for Event Handlers
  const pickerStepRef = useRef(pickerStep);
  const activeMediaTypeRef = useRef(activeMediaType);
  const seenTitlesRef = useRef(seenTitles);
  const inputIdleTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { pickerStepRef.current = pickerStep; }, [pickerStep]);
  useEffect(() => { activeMediaTypeRef.current = activeMediaType; }, [activeMediaType]);
  useEffect(() => { seenTitlesRef.current = seenTitles; }, [seenTitles]);

  // Video Filter State
  const [videoFilters, setVideoFilters] = useState({
      brightness: 100,
      contrast: 100,
      saturate: 100
  });
  
  // Source Selection UI
  const [showSourceSelector, setShowSourceSelector] = useState(false);
  const [availableSources, setAvailableSources] = useState<DesktopSource[]>([]);
  const [sourceTab, setSourceTab] = useState<'screen' | 'window'>('screen');
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const [isRefreshingSources, setIsRefreshingSources] = useState(false);
  
  // Audio & Quality State
  const [audioInputDevices, setAudioInputDevices] = useState<MediaDeviceInfo[]>([]);
  const [audioSource, setAudioSource] = useState<string>('system'); 
  const [streamQuality, setStreamQuality] = useState<'1080p' | '1440p' | '4k'>('1080p');
  const [streamFps, setStreamFps] = useState<30 | 60>(60);
  const [streamBitrate, setStreamBitrate] = useState<number>(0); // 0 for automatic, in kbps
  const [showAudioHelp, setShowAudioHelp] = useState(false);

  // Media State
  const [isSharing, setIsSharing] = useState(false);
  const [localVolume, setLocalVolume] = useState(0); 
  const [stats, setStats] = useState<StreamStats>({ resolution: 'N/A', bitrate: '0', fps: 0, packetLoss: '0', latency: '0' });
  
  // 3D Hype Emoji State
  const [floatingEmojis, setFloatingEmojis] = useState<FloatingEmoji[]>([]);

  // Chat & Peers
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [members, setMembers] = useState<Member[]>([]);

  // Refs
  const peersRef = useRef<Map<string, SimplePeer.Instance>>(new Map());
  const videoRef = useRef<HTMLVideoElement>(null);
  const ambilightRef = useRef<HTMLVideoElement>(null); // Ref for Ambilight Glow
  const streamRef = useRef<MediaStream | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const controlsTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const statsIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const chatRef = useRef<ChatHandle>(null);

  // Safety Check
  const electronAvailable = typeof window !== 'undefined' && window.electron !== undefined;
  const isMac = typeof navigator !== 'undefined' && navigator.platform.toUpperCase().indexOf('MAC') >= 0;

  const activeTheme = THEMES[currentTheme] || THEMES['default'];

  const startRoom = () => {
    if (!electronAvailable) {
        alert("Electron API not found. Please run within the Electron app.");
        return;
    }
    setIsInitializing(true);
    // Get Tailscale IP for display
    window.electron.getTailscaleStatus().then(status => {
        const ips = status?.Self?.TailscaleIPs;
        if (ips && ips.length > 0) {
            setMyIp(ips[0]);
        } else {
            setMyIp("127.0.0.1"); 
        }
    }).catch(e => {
        console.error("Failed to get Tailscale status", e);
        setMyIp("127.0.0.1");
    });

    window.electron.toggleWebServer(isWebStreamEnabled);
    window.electron.startHostServer(65432);
  };

  const performCleanup = () => {
      peersRef.current.forEach(p => {
          try { p.destroy(); } catch (e) { console.error("Error destroying peer", e); }
      });
      peersRef.current.clear();
      stopSharing();
      if (statsIntervalRef.current) clearInterval(statsIntervalRef.current);
      
      if (electronAvailable) {
          window.electron.toggleWebServer(false);
          window.electron.stopHostServer(); 
      }
  };

  const handleEndSession = () => {
      performCleanup();
      onBack();
  };

  useEffect(() => {
    const handleFsChange = () => {
        const isFs = !!document.fullscreenElement;
        setIsFullscreen(isFs);
        if (!isFs) {
            setIsTheaterMode(false); // Auto-exit theater mode
        }
    };
    document.addEventListener('fullscreenchange', handleFsChange);
    
    return () => {
        document.removeEventListener('fullscreenchange', handleFsChange);
        performCleanup();
    };
  }, []);

  // Smart Auto-Hide Logic
  const resetInputIdleTimer = () => {
      setIsInputIdle(false);
      if (inputIdleTimeoutRef.current) clearTimeout(inputIdleTimeoutRef.current);
      
      // If focused, set timer to hide after 4s of inactivity
      if (isInputFocused) {
          inputIdleTimeoutRef.current = setTimeout(() => {
              setIsInputIdle(true);
          }, 4000);
      }
  };

  useEffect(() => {
      // Reset idle timer when focus changes
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

  // Auto-wake chat on typing in Theater/Fullscreen
  useEffect(() => {
      const handleGlobalKeyDown = (e: KeyboardEvent) => {
          resetInputIdleTimer(); // Wake on any key
          if ((isTheaterMode || isFullscreen) && !isInputFocused) {
              // Ignore control keys, function keys, etc.
              if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
                  setShowControls(true);
                  chatRef.current?.focusInput();
              }
          }
      };
      window.addEventListener('keydown', handleGlobalKeyDown);
      return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [isTheaterMode, isFullscreen, isInputFocused]);

  // Hype Emoji Logic
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

  const handleHypeAction = (emoji: string) => {
      spawnHypeEmojis(emoji); 
      broadcast({ type: 'hype', payload: { emoji } });
  };

  // Fetch Audio Input Devices
  useEffect(() => {
      const fetchAudioDevices = async () => {
          try {
              const devices = await navigator.mediaDevices.enumerateDevices();
              setAudioInputDevices(devices.filter(d => d.kind === 'audioinput'));
          } catch (e) {
              console.error("Failed to enumerate audio devices", e);
          }
      };
      fetchAudioDevices();
  }, [showSourceSelector]);

  // Update default audio capture based on source type
  useEffect(() => {
      if (sourceTab === 'screen') {
          setAudioSource('system');
      } else {
          setAudioSource('none'); 
      }
  }, [sourceTab]);

  useEffect(() => {
    if (!electronAvailable) return;

    window.electron.onHostServerStarted((res) => {
        if (res.success || res.port) {
            setIsRoomStarted(true);
            setIsInitializing(false);
            setMembers([{ id: 'HOST', name: username, isHost: true }]);
        } else {
            alert("Failed to start server: " + res.error);
            setIsInitializing(false);
        }
    });

    window.electron.onHostClientConnected(({ socketId }) => {
        const p = new SimplePeer({
            initiator: true,
            trickle: false,
            stream: streamRef.current || undefined
        });

        p.on('signal', (data) => {
            if (data.type === 'offer' && streamBitrate > 0) {
                data.sdp = setVideoBitrate(data.sdp, streamBitrate);
            }
            window.electron.hostSendSignal(socketId, { type: 'signal', data });
        });

        p.on('connect', () => {
            sendDataToPeer(p, { type: 'members', payload: members });
            // Sync theme on connect
            sendDataToPeer(p, { type: 'theme_change', payload: currentTheme });
        });

        p.on('data', (data) => {
            handleData(socketId, data);
        });

        p.on('close', () => {
            handlePeerDisconnect(socketId);
        });

        peersRef.current.set(socketId, p);
    });

    window.electron.onHostSignalReceived(({ socketId, data }) => {
        if (data.type === 'signal') {
            const p = peersRef.current.get(socketId);
            if (p) p.signal(data.data);
        }
    });

    window.electron.onHostClientDisconnected(({ socketId }) => {
        handlePeerDisconnect(socketId);
    });

    return () => {
        window.electron.removeAllListeners('host-server-started');
        window.electron.removeAllListeners('host-client-connected');
        window.electron.removeAllListeners('host-signal-received');
        window.electron.removeAllListeners('host-client-disconnected');
    };
  }, [members, username, electronAvailable, currentTheme, streamBitrate]);

  // Nerd Stats Logic
  useEffect(() => {
      if (isSharing && showNerdStats) {
          statsIntervalRef.current = setInterval(() => {
              const firstPeer = peersRef.current.values().next().value;
              const peerAny = firstPeer as any;
              if (peerAny && peerAny._pc) {
                  peerAny._pc.getStats().then((reports: any) => {
                      reports.forEach((report: any) => {
                          if (report.type === 'outbound-rtp' && report.kind === 'video') {
                              if (videoRef.current) {
                                setStats(prev => ({
                                    ...prev,
                                    resolution: `${videoRef.current?.videoWidth}x${videoRef.current?.videoHeight}`,
                                    fps: report.framesPerSecond || 60,
                                }));
                              }
                          }
                          if (report.type === 'candidate-pair' && report.state === 'succeeded') {
                              setStats(prev => ({
                                  ...prev,
                                  latency: `${Math.round(report.currentRoundTripTime * 1000)} ms`,
                                  bitrate: `${(report.availableOutgoingBitrate / 1000000).toFixed(1)} Mbps` 
                              }));
                          }
                      });
                  });
              }
          }, 1000);
      } else {
          if (statsIntervalRef.current) clearInterval(statsIntervalRef.current);
      }
      return () => {
          if (statsIntervalRef.current) clearInterval(statsIntervalRef.current);
      };
  }, [isSharing, showNerdStats]);


  // Force mute on start sharing
  useEffect(() => {
    if (isSharing && videoRef.current) {
        setLocalVolume(0);
    }
  }, [isSharing]);

  // Ensure Video Element is Attached when Sharing Starts
  useEffect(() => {
      if (isSharing && videoRef.current && streamRef.current) {
          videoRef.current.srcObject = streamRef.current;
          videoRef.current.play().catch(e => console.error("Error playing local preview:", e));
          
          // Set Ambilight Src
          if (ambilightRef.current) {
              ambilightRef.current.srcObject = streamRef.current;
              ambilightRef.current.play().catch(() => {});
          }
      }
  }, [isSharing]);

  // Sync localVolume with video element
  useEffect(() => {
      if (videoRef.current) {
          videoRef.current.volume = localVolume;
          videoRef.current.muted = (localVolume === 0);
      }
  }, [localVolume]);

  const handlePeerDisconnect = (socketId: string) => {
      if (peersRef.current.has(socketId)) {
          peersRef.current.get(socketId)?.destroy();
          peersRef.current.delete(socketId);
      }
      setMembers(prev => prev.filter(m => m.id !== socketId));
      broadcast({ type: 'members', payload: members.filter(m => m.id !== socketId) });
  };

  const handleData = (socketId: string, data: any) => {
      try {
        const parsed = JSON.parse(data.toString());
        
        if (parsed.type === 'join') {
            const newMember = { id: socketId, name: parsed.name, isHost: false };
            setMembers(prev => {
                const exists = prev.find(m => m.id === socketId);
                if (exists) return prev;
                const updated = [...prev, newMember];
                setTimeout(() => broadcast({ type: 'members', payload: updated }), 100);
                return updated;
            });
            // Send current theme to new joiner
            const p = peersRef.current.get(socketId);
            if (p) sendDataToPeer(p, { type: 'theme_change', payload: currentTheme });
        }

        if (parsed.type === 'chat') {
            const msg = parsed.payload;
            setMessages(prev => {
                if (prev.some(m => m.id === msg.id)) return prev;
                return [...prev, msg];
            });
            broadcast({ type: 'chat', payload: msg });
        }

        if (parsed.type === 'hype') {
            spawnHypeEmojis(parsed.payload.emoji); // Spawn locally
            broadcast({ type: 'hype', payload: parsed.payload }); // Relay to other viewers
        }

        if (parsed.type === 'picker_action') {
            handlePickerInteraction(parsed.payload.action, parsed.payload.value);
        }

      } catch (e) { console.error("Data parse error", e); }
  };

  const broadcast = (data: any) => {
      const str = JSON.stringify(data);
      peersRef.current.forEach(p => {
          if (p.connected) p.send(str);
      });
  };

  const sendDataToPeer = (peer: SimplePeer.Instance, data: any) => {
      if (peer.connected) peer.send(JSON.stringify(data));
  };

  const prepareScreenShare = async () => {
      if (!electronAvailable) return;
      setIsRefreshingSources(true);
      try {
          const sources = await window.electron.getDesktopSources();
          setAvailableSources(sources);
          setShowSourceSelector(true);
          if (!selectedSourceId || !sources.find(s => s.id === selectedSourceId)) {
              setSelectedSourceId(null);
          }
      } catch (e) {
          console.error("Failed to get sources", e);
      } finally {
          setIsRefreshingSources(false);
      }
  };

  const startStream = async (sourceId: string) => {
      setShowSourceSelector(false);
      try {
          let finalStream: MediaStream;
          let maxWidth = 1920;
          let maxHeight = 1080;

          if (streamQuality === '4k') {
              maxWidth = 3840;
              maxHeight = 2160;
          } else if (streamQuality === '1440p') {
              maxWidth = 2560;
              maxHeight = 1440;
          }

          const videoConstraints = {
              mandatory: {
                  chromeMediaSource: 'desktop',
                  chromeMediaSourceId: sourceId,
                  maxWidth: maxWidth,
                  maxHeight: maxHeight,
                  minFrameRate: streamFps,
                  maxFrameRate: streamFps
              }
          };

          if (audioSource === 'none') {
              finalStream = await navigator.mediaDevices.getUserMedia({
                  audio: false,
                  video: videoConstraints
              } as any);

          } else if (audioSource === 'system') {
              finalStream = await navigator.mediaDevices.getUserMedia({
                  audio: {
                      mandatory: { chromeMediaSource: 'desktop' }
                  },
                  video: videoConstraints
              } as any);

              if (sourceTab === 'screen') {
                  setLocalVolume(0);
              }

          } else {
              const videoStream = await navigator.mediaDevices.getUserMedia({
                  audio: false,
                  video: videoConstraints
              } as any);

              try {
                  const audioStream = await navigator.mediaDevices.getUserMedia({
                      audio: { 
                          deviceId: { exact: audioSource },
                          autoGainControl: false,
                          echoCancellation: false,
                          noiseSuppression: false,
                          channelCount: 2, 
                          latency: 0.01 
                      } as any,
                      video: false
                  });

                  finalStream = new MediaStream([
                      ...videoStream.getVideoTracks(),
                      ...audioStream.getAudioTracks()
                  ]);
              } catch (audioErr) {
                  console.error("Audio device capture failed", audioErr);
                  alert("Failed to capture selected audio device. Starting video only.");
                  finalStream = videoStream;
              }
          }

          streamRef.current = finalStream;
          setIsSharing(true);

          peersRef.current.forEach(p => {
              p.addStream(finalStream);
          });

      } catch (e) {
          console.error("Failed to capture screen", e);
          alert("Failed to start stream: " + e);
      }
  };

  const stopSharing = () => {
      broadcast({ type: 'stream_stopped' });

      if (streamRef.current) {
          streamRef.current.getTracks().forEach(t => t.stop());
          peersRef.current.forEach(p => p.removeStream(streamRef.current!));
          streamRef.current = null;
      }
      if (videoRef.current) videoRef.current.srcObject = null;
      if (ambilightRef.current) ambilightRef.current.srcObject = null;
      setIsSharing(false);
  };

  const toggleMute = () => {
      if (localVolume > 0) {
          setLocalVolume(0);
      } else {
          setLocalVolume(0.5); 
          if (audioSource === 'system' && sourceTab === 'screen') {
              setTimeout(() => alert("Warning: Unmuting your own stream while sharing system audio causes an infinite echo loop. Only unmute if using headphones and not sharing system audio."), 100);
          }
      }
  };

  const takeScreenshot = () => {
      if (!videoRef.current) return;
      const canvas = document.createElement('canvas');
      canvas.width = videoRef.current.videoWidth;
      canvas.height = videoRef.current.videoHeight;
      const ctx = canvas.getContext('2d');
      if (ctx) {
          ctx.filter = `brightness(${videoFilters.brightness}%) contrast(${videoFilters.contrast}%) saturate(${videoFilters.saturate}%)`;
          ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
          const dataUrl = canvas.toDataURL('image/png');
          const link = document.createElement('a');
          link.download = `sheiyuwatch-snap-${Date.now()}.png`;
          link.href = dataUrl;
          link.click();
      }
  };

  const toggleFullscreen = () => {
    const elem = containerRef.current;
    if (!document.fullscreenElement) {
        elem?.requestFullscreen().catch(err => console.log(err));
    } else {
        document.exitFullscreen();
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

  // --- SHARED MOVIE SUGGESTER LOGIC ---
  const startSharedPicker = () => {
      if (pickerStepRef.current !== 'idle' && pickerStepRef.current !== 'reveal') return; 

      setPickerStep('type');
      pickerStepRef.current = 'type'; 
      
      const msg: ChatMessage = { 
        id: Date.now().toString(), 
        senderId: 'HOST', 
        senderName: 'SYSTEM', 
        text: '', 
        timestamp: Date.now(), 
        isSystemEvent: true,
        eventPayload: { state: 'type_selection' }
      };
      setMessages(p => [...p, msg]);
      broadcast({ type: 'chat', payload: msg });
  };

  const handlePickerInteraction = (action: string, value?: string) => {
      if (action === 'start_picker') { // Action from viewer
          startSharedPicker();
          return;
      }

      const msgId = Date.now().toString();
      let payload: any = {};

      const currentStep = pickerStepRef.current;
      const currentMediaType = activeMediaTypeRef.current;
      const seen = seenTitlesRef.current;

      if (action === 'select_type') {
          if (currentStep !== 'type') return; 
          const type = value as MediaType;
          
          setActiveMediaType(type);
          activeMediaTypeRef.current = type;
          
          setPickerStep('genre');
          pickerStepRef.current = 'genre';
          
          payload = { state: 'genre_selection', mediaType: type };
      } 
      else if (action === 'select_genre') {
          if (currentStep !== 'genre') return;
          const genre = value as Genre;
          
          // BROADCAST THEME CHANGE!
          setCurrentTheme(genre);
          broadcast({ type: 'theme_change', payload: genre });

          setPickerStep('reveal');
          pickerStepRef.current = 'reveal';
          
          const database = currentMediaType === 'Movie' ? MOVIE_DB : SHOW_DB;
          const allOptions = database[genre] || [];
          let available = allOptions.filter(m => !seen.has(m.title));
          if (available.length < 3) available = allOptions;
          const shuffled = [...available].sort(() => 0.5 - Math.random());
          const picks = shuffled.slice(0, 3);
          
          setSeenTitles(prev => {
              const next = new Set(prev);
              picks.forEach(p => next.add(p.title));
              return next;
          });
          
          payload = { state: 'reveal', mediaType: currentMediaType, genre, movies: picks };
      }
      else if (action === 'reroll') {
          if (currentStep !== 'reveal') return; 
          const genre = value as Genre;
          const database = currentMediaType === 'Movie' ? MOVIE_DB : SHOW_DB;
          const allOptions = database[genre] || [];
          let available = allOptions.filter(m => !seen.has(m.title));
          if (available.length < 3) available = allOptions;
          const shuffled = [...available].sort(() => 0.5 - Math.random());
          const picks = shuffled.slice(0, 3);
          
          setSeenTitles(prev => {
              const next = new Set(prev);
              picks.forEach(p => next.add(p.title));
              return next;
          });
          
          payload = { state: 'reveal', mediaType: currentMediaType, genre, movies: picks };
      }

      const msg: ChatMessage = { 
        id: msgId, 
        senderId: 'HOST', 
        senderName: 'SYSTEM', 
        text: '', 
        timestamp: Date.now(), 
        isSystemEvent: true,
        eventPayload: payload
      };
      setMessages(p => [...p, msg]);
      broadcast({ type: 'chat', payload: msg });
  };

  const handleSendMessage = (text: string, type: 'text' | 'gif' = 'text', replyTo?: ReplyContext) => {
      const msg: ChatMessage = { 
        id: Date.now().toString() + Math.floor(Math.random() * 1000), 
        senderId: 'HOST', 
        senderName: username, 
        text, 
        timestamp: Date.now(), 
        type,
        replyTo,
        reactions: {}
      };
      setMessages(p => {
          if (p.some(m => m.id === msg.id)) return p;
          return [...p, msg];
      });
      broadcast({ type: 'chat', payload: msg });
  };

  if (!isRoomStarted) {
      return (
        <div className="min-h-screen bg-black flex flex-col items-center justify-center p-4 relative overflow-hidden">
             <div className="absolute inset-0 z-0 pointer-events-none">
                <div className="absolute top-[-10%] left-[20%] w-[40vw] h-[40vw] bg-blue-900/20 rounded-full blur-[128px] animate-blob" />
                <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-20 mix-blend-overlay"></div>
             </div>
             <button onClick={onBack} className="absolute top-8 left-8 text-gray-400 hover:text-white flex items-center gap-2 z-20">
                <ArrowLeft size={16} /> Back
             </button>
             <div className="relative z-10 max-w-md w-full bg-white/5 backdrop-blur-xl rounded-3xl p-8 border border-white/10 shadow-2xl text-center">
                <Zap className="w-12 h-12 text-blue-400 mx-auto mb-4" />
                <h2 className="text-3xl font-bold text-white mb-2">Initialize Host</h2>
                <p className="text-gray-400 mb-6 text-sm">Start a secure P2P server on your local network.</p>
                
                <div className="flex items-center justify-between bg-black/30 p-3 rounded-xl mb-4 border border-white/5">
                    <div className="flex items-center gap-3 text-left">
                        <Globe size={18} className={isWebStreamEnabled ? "text-green-400" : "text-gray-500"} />
                        <div>
                            <p className="text-xs font-bold text-white">Web Browser Streaming</p>
                            <p className="text-[10px] text-gray-400">Host a website for phones/tablets</p>
                        </div>
                    </div>
                    <button 
                        onClick={() => setIsWebStreamEnabled(!isWebStreamEnabled)}
                        className={`w-10 h-5 rounded-full relative transition-colors ${isWebStreamEnabled ? 'bg-green-600' : 'bg-gray-600'}`}
                    >
                        <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all ${isWebStreamEnabled ? 'left-6' : 'left-1'}`}></div>
                    </button>
                </div>

                <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-xl p-3 mb-6 text-left flex gap-3">
                    <AlertTriangle className="text-yellow-500 flex-shrink-0" size={20} />
                    <p className="text-xs text-yellow-200/80">
                        <strong>Windows Users:</strong> If friends can't connect, you must allow this app through <strong>Windows Defender Firewall</strong> (Public & Private).
                    </p>
                </div>

                <Button className="w-full py-4" size="lg" onClick={startRoom} isLoading={isInitializing}>
                    INITIALIZE SERVER
                </Button>
                {!electronAvailable && <p className="text-red-500 text-xs mt-4">Error: Electron API unavailable.</p>}
             </div>
        </div>
      );
  }

  const displayedSources = availableSources.filter(s => {
      if (sourceTab === 'screen') return s.id.toLowerCase().startsWith('screen');
      return s.id.toLowerCase().startsWith('window');
  });

  const controlsVisible = showControls || (isInputFocused && !isInputIdle);
  const sidebarCollapsed = isTheaterMode || isFullscreen;

  return (
    <div className="flex flex-col md:flex-row h-[100dvh] bg-[#313338] text-gray-100 overflow-hidden font-sans relative transition-colors duration-500">
      
      <div className={`flex flex-col relative bg-black min-w-0 transition-all duration-500 ease-in-out ${sidebarCollapsed ? 'w-full h-full' : 'w-full h-[35vh] md:h-full md:flex-1'}`}>
        
        {/* TOP BAR */}
        <div className={`absolute top-0 left-0 right-0 z-20 p-4 flex justify-between items-start pointer-events-none transition-opacity duration-300 ${controlsVisible ? 'opacity-100' : 'opacity-0'}`}>
            <div className="flex gap-2 pointer-events-auto">
                <div className={`bg-black/60 backdrop-blur border ${activeTheme.border} rounded-lg px-3 py-1.5 flex items-center gap-2 shadow-lg`}>
                    <div className={`w-2 h-2 rounded-full ${members.length > 1 ? 'bg-green-500' : 'bg-yellow-500 animate-pulse'}`}></div>
                    <span className="text-xs font-bold text-gray-200">{members.length - 1} Watching</span>
                </div>
                {isWebStreamEnabled && (
                    <div className="hidden md:flex bg-black/60 backdrop-blur border border-white/10 rounded-lg px-3 py-1.5 items-center gap-2 shadow-lg">
                        <Globe size={12} className={activeTheme.primary} />
                        <span className="text-xs font-mono text-gray-300">http://{myIp}:8080</span>
                    </div>
                )}
            </div>
            <Button variant="secondary" size="sm" onClick={() => setShowExitConfirm(true)} className="pointer-events-auto bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500 hover:text-white transition-all">
                <Power size={14} className="mr-2" /> End Session
            </Button>
        </div>

        {/* VIDEO CONTAINER */}
        <div 
            ref={containerRef}
            className="flex-1 flex items-center justify-center relative bg-black overflow-hidden group"
            onMouseMove={() => {
                setShowControls(true);
                resetInputIdleTimer();
                if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
                controlsTimeoutRef.current = setTimeout(() => setShowControls(false), 2500);
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
          {/* EXIT CONFIRMATION MODAL */}
          {showExitConfirm && (
            <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
                <div className="bg-[#1e1f22] border border-red-500/20 rounded-2xl p-6 max-w-sm w-full shadow-2xl scale-100 animate-in zoom-in-95 duration-200">
                    <div className="flex items-center gap-3 mb-4 text-red-400">
                        <AlertCircle size={24} />
                        <h3 className="text-lg font-bold">End Session?</h3>
                    </div>
                    <p className="text-gray-300 text-sm mb-6">
                        Are you sure you want to leave? This will end the stream and disconnect all {members.length - 1} connected viewers.
                    </p>
                    <div className="flex gap-3 justify-end">
                        <Button variant="ghost" onClick={() => setShowExitConfirm(false)}>Cancel</Button>
                        <Button variant="danger" onClick={handleEndSession}>End Session</Button>
                    </div>
                </div>
            </div>
          )}

          {/* SOURCE SELECTOR */}
          {showSourceSelector && (
            <div className="fixed inset-0 z-[80] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
                <div className="bg-[#1e1f22] border border-white/10 rounded-2xl max-w-4xl w-full max-h-[85vh] flex flex-col shadow-2xl scale-100 animate-in zoom-in-95 duration-200">
                    <div className="p-6 border-b border-white/10 flex justify-between items-center">
                        <h2 className="text-xl font-bold text-white flex items-center gap-2">
                            <ScreenShare className={activeTheme.primary} /> Select Content to Share
                        </h2>
                        <button onClick={() => setShowSourceSelector(false)} className="text-gray-400 hover:text-white"><X /></button>
                    </div>
                    
                    <div className="flex p-2 bg-black/20 mx-6 mt-6 rounded-lg">
                        <button onClick={() => setSourceTab('screen')} className={`flex-1 py-2 rounded-md text-sm font-bold transition-colors ${sourceTab === 'screen' ? `${activeTheme.bg} text-white shadow-lg` : 'text-gray-400 hover:text-white'}`}>Screens</button>
                        <button onClick={() => setSourceTab('window')} className={`flex-1 py-2 rounded-md text-sm font-bold transition-colors ${sourceTab === 'window' ? `${activeTheme.bg} text-white shadow-lg` : 'text-gray-400 hover:text-white'}`}>Windows</button>
                    </div>

                    <div className="p-6 flex gap-4 overflow-x-auto min-h-0 flex-1 scrollbar-hide">
                        {isRefreshingSources ? (
                            <div className="w-full py-20 flex flex-col items-center justify-center text-gray-500 animate-pulse">
                                <RefreshCw className="animate-spin mb-2" size={32} />
                                <p>Loading sources...</p>
                            </div>
                        ) : displayedSources.length === 0 ? (
                            <div className="w-full py-10 flex flex-col items-center justify-center bg-red-500/10 border border-red-500/20 rounded-xl p-6 text-center">
                                {isMac ? (
                                    <>
                                        <AlertTriangle className="text-red-400 mb-2" size={32} />
                                        <h3 className="text-white font-bold mb-1">MacOS Permission Error</h3>
                                        <p className="text-gray-400 text-xs mb-4 max-w-md">
                                            macOS is blocking screen recording. Check permissions.
                                        </p>
                                    </>
                                ) : (
                                    <p className="text-gray-500">No sources found.</p>
                                )}
                            </div>
                        ) : (
                            displayedSources.map(source => (
                                <button
                                    key={source.id}
                                    onClick={() => setSelectedSourceId(source.id)}
                                    className={`flex-shrink-0 w-64 group relative rounded-xl overflow-hidden border-2 transition-all ${selectedSourceId === source.id ? `${activeTheme.border} ring-2 ring-opacity-30 bg-white/5` : 'border-white/5 hover:border-white/20 bg-[#2b2d31]'}`}
                                >
                                    <div className="h-32 flex items-center justify-center bg-black relative overflow-hidden">
                                        <img src={source.thumbnail} alt={source.name} className="max-w-full max-h-full object-contain" />
                                        {selectedSourceId === source.id && (
                                            <div className={`absolute inset-0 bg-black/20 flex items-center justify-center`}>
                                                <div className={`${activeTheme.bg} rounded-full p-2 shadow-lg`}><Check size={20} className="text-white" /></div>
                                            </div>
                                        )}
                                    </div>
                                    <div className="p-3 text-left">
                                        <p className="text-xs font-bold text-gray-200 truncate" title={source.name}>{source.name}</p>
                                    </div>
                                </button>
                            ))
                        )}
                    </div>

                    <div className="p-6 border-t border-white/10 bg-black/20 rounded-b-2xl flex flex-col gap-4">
                        <div className="flex flex-col md:flex-row gap-4 justify-between items-end">
                            <div className="flex flex-col gap-4 flex-1 w-full">
                                 <div className="flex items-center gap-2">
                                    <label className="text-xs font-bold text-gray-400 w-24">Stream Quality:</label>
                                    <select 
                                        value={streamQuality}
                                        onChange={(e) => setStreamQuality(e.target.value as any)}
                                        className="bg-black/40 border border-white/10 rounded px-3 py-1.5 text-xs text-white focus:border-blue-500 outline-none cursor-pointer flex-1 max-w-[200px]"
                                    >
                                        <option value="1080p">1080p (Smooth)</option>
                                        <option value="1440p">1440p (QHD)</option>
                                        <option value="4k">4K (Ultra HD)</option>
                                    </select>
                                 </div>
                                 <div className="flex items-center gap-2">
                                    <label className="text-xs font-bold text-gray-400 w-24">Frame Rate:</label>
                                    <select
                                        value={streamFps}
                                        onChange={(e) => setStreamFps(Number(e.target.value) as 30 | 60)}
                                        className="bg-black/40 border border-white/10 rounded px-3 py-1.5 text-xs text-white focus:border-blue-500 outline-none cursor-pointer flex-1 max-w-[200px]"
                                    >
                                        <option value={60}>60 FPS (Silky Smooth)</option>
                                        <option value={30}>30 FPS (Standard)</option>
                                    </select>
                                 </div>
                                 <div className="flex items-center gap-2">
                                     <label className="text-xs font-bold text-gray-400 w-24">Bitrate:</label>
                                     <select
                                         value={streamBitrate}
                                         onChange={(e) => setStreamBitrate(Number(e.target.value))}
                                         className="bg-black/40 border border-white/10 rounded px-3 py-1.5 text-xs text-white focus:border-blue-500 outline-none cursor-pointer flex-1 max-w-[200px]"
                                     >
                                         <option value={0}>Automatic (Default)</option>
                                         <option value={15000}>High (15 Mbps)</option>
                                         <option value={30000}>Extreme (30 Mbps)</option>
                                         <option value={50000}>Insane (50 Mbps)</option>
                                     </select>
                                 </div>

                                 <div className="flex items-center gap-2">
                                    <div className="flex items-center gap-1 w-24">
                                        <label className="text-xs font-bold text-gray-400">Audio Source:</label>
                                        <div 
                                            className="relative flex items-center"
                                            onMouseEnter={() => setShowAudioHelp(true)}
                                            onMouseLeave={() => setShowAudioHelp(false)}
                                        >
                                            <HelpCircle size={12} className="text-gray-500 cursor-help" />
                                            {showAudioHelp && (
                                                <div className="absolute bottom-full left-0 mb-2 w-64 p-3 bg-black border border-white/20 rounded-lg text-[10px] text-gray-300 shadow-xl z-50 animate-in fade-in duration-200">
                                                    <p className="mb-2"><strong className="text-white">How to isolate browser audio?</strong></p>
                                                    <ol className="list-decimal pl-3 space-y-1">
                                                        <li>Install <strong>VB-CABLE</strong> driver.</li>
                                                        <li>Open Windows <strong>"Volume mixer"</strong>.</li>
                                                        <li>Change your Browser's Output to <strong>CABLE Input</strong>.</li>
                                                        <li>Select <strong>CABLE Output</strong> in this menu.</li>
                                                    </ol>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                    <select 
                                        value={audioSource} 
                                        onChange={(e) => setAudioSource(e.target.value)}
                                        className="bg-black/40 border border-white/10 rounded px-3 py-1.5 text-xs text-white focus:border-blue-500 outline-none cursor-pointer flex-1 max-w-[300px]"
                                    >
                                        <option value="none">No Audio (Silent)</option>
                                        <option value="system">System Audio (Entire PC)</option>
                                        <optgroup label="Specific Inputs (For Isolation)">
                                            {audioInputDevices.map(device => (
                                                <option key={device.deviceId} value={device.deviceId}>
                                                    {device.label || `Microphone ${device.deviceId.slice(0,5)}...`}
                                                </option>
                                            ))}
                                        </optgroup>
                                    </select>
                                 </div>
                            </div>

                            <div className="flex gap-3">
                                <button onClick={prepareScreenShare} className="p-2 bg-white/10 rounded-lg hover:bg-white/20 text-gray-400 hover:text-white" title="Refresh Sources">
                                    <RefreshCw size={20} />
                                </button>
                                <Button variant="ghost" onClick={() => setShowSourceSelector(false)}>Cancel</Button>
                                <Button disabled={!selectedSourceId} onClick={() => startStream(selectedSourceId!)}>
                                    Go Live
                                </Button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
          )}

          {!isSharing ? (
            <div className="text-center relative z-10">
                <div className="w-20 h-20 bg-white/5 rounded-full flex items-center justify-center mx-auto mb-6 animate-pulse">
                    <ScreenShare size={32} className="text-gray-500" />
                </div>
                <Button size="lg" onClick={prepareScreenShare} className="animate-in zoom-in duration-300">
                    Start Screen Share
                </Button>
                <p className="text-gray-500 text-xs mt-4">Select a Screen, Window, or Tab</p>
            </div>
          ) : (
             <>
                {/* AMBILIGHT LAYER */}
                <video 
                    ref={ambilightRef}
                    className="absolute inset-0 w-full h-full object-cover blur-[80px] opacity-60 pointer-events-none"
                    muted
                />

                {showNerdStats && (
                    <div className="absolute top-16 left-4 bg-black/60 backdrop-blur-md border border-white/10 p-3 rounded-lg z-30 text-[10px] font-mono text-gray-300 pointer-events-none select-none animate-in slide-in-from-left-2">
                        <h4 className={`${activeTheme.primary} font-bold mb-1 flex items-center gap-1`}><Activity size={10}/> STREAM STATS</h4>
                        <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                            <span>Resolution:</span> <span className="text-white">{stats.resolution}</span>
                            <span>FPS:</span> <span className="text-white">{Math.round(stats.fps)}</span>
                            <span>Bitrate:</span> <span className="text-green-400">{stats.bitrate}</span>
                            <span>Packet Loss:</span> <span className="text-white">{stats.packetLoss}</span>
                        </div>
                    </div>
                )}

                <video 
                    ref={videoRef} 
                    className="relative z-10 w-full h-full object-contain drop-shadow-2xl" 
                    autoPlay 
                    playsInline 
                    style={{
                        filter: `brightness(${videoFilters.brightness}%) contrast(${videoFilters.contrast}%) saturate(${videoFilters.saturate}%)`
                    }}
                />
             </>
          )}

          {(isTheaterMode || isFullscreen) && (
               <div className={`absolute bottom-32 left-4 w-[400px] max-w-[80vw] z-[60] flex flex-col justify-end transition-opacity duration-300`}>
                  <Chat 
                    ref={chatRef}
                    messages={messages} 
                    onSendMessage={handleSendMessage} 
                    onAddReaction={() => {}}
                    onHypeEmoji={handleHypeAction}
                    onPickerAction={handlePickerInteraction}
                    myId="HOST" 
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
                 
                 {/* Volume */}
                 <div className="flex items-center gap-2 group/vol">
                    <button onClick={toggleMute} className="p-2 hover:bg-white/10 rounded-full transition-colors active:scale-95">
                        {localVolume === 0 ? <VolumeX size={20} className="text-red-400" /> : <Volume2 size={20} className="text-gray-300 group-hover/vol:text-white" />}
                    </button>
                    <div className="w-0 overflow-hidden group-hover/vol:w-24 transition-all duration-300 flex items-center">
                        <input 
                            type="range" min="0" max="1" step="0.05" 
                            value={localVolume} onChange={(e) => setLocalVolume(parseFloat(e.target.value))}
                            className={`w-full h-1.5 rounded-lg appearance-none cursor-pointer transition-colors bg-white/20 hover:bg-white/30 ${activeTheme.accent}`}
                        />
                    </div>
                 </div>

                 <div className="w-px h-6 bg-white/10"></div>

                 <div className="flex gap-2">
                     <button 
                        onClick={() => setShowVideoSettings(!showVideoSettings)} 
                        className={`p-2.5 rounded-full transition-all active:scale-95 ${showVideoSettings ? `${activeTheme.bg} text-white shadow-lg ${activeTheme.glow}` : 'bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white'}`}
                        title="Video Settings"
                     >
                         <Sliders size={18} />
                     </button>
                     <button 
                        onClick={takeScreenshot} 
                        className="p-2.5 rounded-full bg-white/5 hover:bg-white/10 text-gray-300 transition-all hover:text-white active:scale-95"
                        title="Take Screenshot"
                     >
                         <Camera size={18} />
                     </button>
                     <button 
                        onClick={startSharedPicker} 
                        disabled={(pickerStep !== 'idle' && pickerStep !== 'reveal') || isSharing}
                        className={`p-2.5 rounded-full transition-all active:scale-95 disabled:cursor-not-allowed disabled:text-gray-600 disabled:bg-white/5 ${ (pickerStep !== 'idle' && pickerStep !== 'reveal') ? 'bg-white/5 text-gray-600' : `${activeTheme.primary} bg-white/5 hover:bg-white/10 hover:${activeTheme.primary.replace('text-', 'text-opacity-80')}`}`}
                        title="Suggest Movie"
                     >
                         <Clapperboard size={18} />
                     </button>
                     {isSharing && (
                        <button
                            onClick={stopSharing}
                            className="p-2.5 rounded-full bg-red-500/20 hover:bg-red-500 text-red-400 hover:text-white transition-all active:scale-95 shadow-lg shadow-red-900/20"
                            title="Stop Stream"
                        >
                            <ScreenShareOff size={18} />
                        </button>
                     )}
                 </div>

                 <div className="w-px h-6 bg-white/10"></div>

                 <div className="flex gap-2 items-center">
                     <button onClick={() => setShowNerdStats(!showNerdStats)} className={`p-2 hover:bg-white/10 rounded-full transition-colors active:scale-95 ${showNerdStats ? `${activeTheme.primary}` : 'text-gray-400 hover:text-white'}`} title="Nerd Stats">
                         <Activity size={18} />
                     </button>
                     <button onClick={togglePiP} className="p-2 hover:bg-white/10 rounded-full text-gray-400 hover:text-white active:scale-95" title="Picture-in-Picture">
                         <PictureInPicture size={18} />
                     </button>
                     <button onClick={() => setIsTheaterMode(!isTheaterMode)} className={`p-2 hover:bg-white/10 rounded-full transition-colors active:scale-95 ${isTheaterMode ? `${activeTheme.primary}` : 'text-gray-400 hover:text-white'}`} title="Theater Mode">
                         <Tv size={18} />
                     </button>
                     <button onClick={toggleFullscreen} className="p-2 hover:bg-white/10 rounded-full text-gray-400 hover:text-white active:scale-95" title="Fullscreen">
                         {isFullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
                     </button>
                 </div>
             </div>
          </div>

          {showVideoSettings && (
              <div className="absolute bottom-24 left-1/2 -translate-x-1/2 bg-[#1e1f22]/90 backdrop-blur-xl border border-white/10 p-4 rounded-2xl shadow-2xl z-30 w-64 animate-in slide-in-from-bottom-4 fade-in">
                  <div className="flex justify-between items-center mb-4 border-b border-white/5 pb-2">
                      <h4 className="text-xs font-bold text-gray-400 uppercase">Adjustments</h4>
                      <button onClick={() => setVideoFilters({ brightness: 100, contrast: 100, saturate: 100 })} title="Reset" className="text-gray-500 hover:text-white transition-colors"><RotateCcw size={12}/></button>
                  </div>
                  <div className="space-y-4">
                      <div className="space-y-1">
                          <div className="flex justify-between text-[10px] text-gray-400 font-medium"><span>Brightness</span><span>{videoFilters.brightness}%</span></div>
                          <input type="range" min="50" max="150" value={videoFilters.brightness} onChange={e => setVideoFilters(p => ({...p, brightness: Number(e.target.value)}))} className={`w-full h-1.5 bg-gray-700 rounded-lg appearance-none cursor-pointer ${activeTheme.accent}`} />
                      </div>
                      <div className="space-y-1">
                          <div className="flex justify-between text-[10px] text-gray-400 font-medium"><span>Contrast</span><span>{videoFilters.contrast}%</span></div>
                          <input type="range" min="50" max="150" value={videoFilters.contrast} onChange={e => setVideoFilters(p => ({...p, contrast: Number(e.target.value)}))} className={`w-full h-1.5 bg-gray-700 rounded-lg appearance-none cursor-pointer ${activeTheme.accent}`} />
                      </div>
                      <div className="space-y-1">
                          <div className="flex justify-between text-[10px] text-gray-400 font-medium"><span>Saturation</span><span>{videoFilters.saturate}%</span></div>
                          <input type="range" min="0" max="200" value={videoFilters.saturate} onChange={e => setVideoFilters(p => ({...p, saturate: Number(e.target.value)}))} className={`w-full h-1.5 bg-gray-700 rounded-lg appearance-none cursor-pointer ${activeTheme.accent}`} />
                      </div>
                  </div>
              </div>
          )}
        </div>
      </div>

      <div className={`bg-black/40 backdrop-blur-xl flex flex-col flex-1 md:flex-none min-h-0 min-w-0 transition-all duration-500 ease-in-out rounded-3xl border ${activeTheme.border} ${activeTheme.glow} shadow-2xl ${sidebarCollapsed ? 'w-0 m-0 opacity-0 border-0 pointer-events-none' : 'w-auto md:w-80 mx-4 mb-4 md:m-4 opacity-100 border'} overflow-hidden`}>
           <div className={`min-w-[320px] h-full flex flex-col transition-transform duration-500 ease-in-out ${sidebarCollapsed ? 'translate-x-full' : 'translate-x-0'}`}>
               <div className="flex p-2 gap-2">
                   <button onClick={() => setActiveTab('chat')} className={`flex-1 py-2 text-xs font-bold rounded-full transition-all ${activeTab === 'chat' ? `bg-white/10 text-white` : 'text-gray-400 hover:text-white hover:bg-white/5'}`}>CHAT</button>
                   <button onClick={() => setActiveTab('members')} className={`flex-1 py-2 text-xs font-bold rounded-full transition-all ${activeTab === 'members' ? `bg-white/10 text-white` : 'text-gray-400 hover:text-white hover:bg-white/5'}`}>MEMBERS</button>
               </div>
               <div className="flex-1 overflow-hidden relative">
                   {activeTab === 'chat' && <div className="absolute inset-0 flex flex-col"><Chat messages={messages} onSendMessage={handleSendMessage} onAddReaction={() => {}} onHypeEmoji={handleHypeAction} onPickerAction={handlePickerInteraction} myId="HOST" theme={activeTheme} /></div>}
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
