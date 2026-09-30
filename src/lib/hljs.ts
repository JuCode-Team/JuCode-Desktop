// highlight.js with the languages code in chats and projects actually uses.
// The full build registers ~190 languages (over 1 MB), which the phone app
// would download before it could show a conversation; `lib/common` has 36,
// plus the few below that come up in coding sessions.
import hljs from 'highlight.js/lib/common';
import dockerfile from 'highlight.js/lib/languages/dockerfile';
import powershell from 'highlight.js/lib/languages/powershell';
import dos from 'highlight.js/lib/languages/dos';
import nginx from 'highlight.js/lib/languages/nginx';
import cmake from 'highlight.js/lib/languages/cmake';
import protobuf from 'highlight.js/lib/languages/protobuf';
import properties from 'highlight.js/lib/languages/properties';
import scala from 'highlight.js/lib/languages/scala';
import dart from 'highlight.js/lib/languages/dart';
import elixir from 'highlight.js/lib/languages/elixir';
import haskell from 'highlight.js/lib/languages/haskell';
import groovy from 'highlight.js/lib/languages/groovy';
import nix from 'highlight.js/lib/languages/nix';

hljs.registerLanguage('dockerfile', dockerfile);
hljs.registerLanguage('powershell', powershell);
hljs.registerLanguage('dos', dos);
hljs.registerLanguage('nginx', nginx);
hljs.registerLanguage('cmake', cmake);
hljs.registerLanguage('protobuf', protobuf);
hljs.registerLanguage('properties', properties);
hljs.registerLanguage('scala', scala);
hljs.registerLanguage('dart', dart);
hljs.registerLanguage('elixir', elixir);
hljs.registerLanguage('haskell', haskell);
hljs.registerLanguage('groovy', groovy);
hljs.registerLanguage('nix', nix);

export default hljs;
